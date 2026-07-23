import dcmjs from 'dcmjs';
import { DicomMetadataStore } from '@ohif/core';

const { DicomDict, DicomMetaDictionary } = dcmjs.data;
const denaturalize = DicomMetaDictionary.denaturalizeDataset;

/**
 * Defaults. Every value can be overridden WITHOUT rebuilding by adding a
 * `nerotechSrTags` block to app-config.js:
 *
 *   window.config = {
 *     ...,
 *     nerotechSrTags: {
 *       Manufacturer: 'Nerotech Solutions LLC',
 *       ImplementationClassUID: '1.2.826.0.1.xxxxxxx.1.1',
 *       // IssuerOfPatientID: 'MY.ISSUER',  // set to force a fixed value
 *       // InstitutionName: 'My Hospital',  // set to force a fixed value
 *     },
 *   };
 *
 * `null` for IssuerOfPatientID / InstitutionName means "copy from the source
 * instance"; a string means "always use this value".
 */
const DEFAULTS = {
  Manufacturer: 'Nerotech Solutions',
  ManufacturerModelName: 'NeroArchiveWEB VIEW SR Writer',
  DeviceSerialNumber: 'NT-001',
  SoftwareVersions: '0.1.0',
  InstitutionName: null,
  IssuerOfPatientID: null,
  ImplementationClassUID: '2.25.310928604770202966761139579056419879264',
  // SH VR: 16 chars max.
  ImplementationVersionName: 'NEROTECH_0.1',
  TransferSyntaxUID: '1.2.840.10008.1.2.1', // Explicit VR Little Endian
};

/** dcmjs-naturalized sequences may be a bare object when there is one item. */
const toArray = x => (Array.isArray(x) ? x : x ? [x] : []);

/**
 * Resolve the source image instance the SR was derived from, so patient
 * identity attributes can be copied from it.
 */
function getSourceInstance(naturalizedReport, measurementData) {
  // Primary: tracked measurements know exactly what they reference.
  const m = measurementData && measurementData[0];
  if (m && m.referenceStudyUID && m.referenceSeriesUID) {
    const inst =
      DicomMetadataStore.getInstance(
        m.referenceStudyUID,
        m.referenceSeriesUID,
        m.SOPInstanceUID
      ) ||
      (DicomMetadataStore.getSeries(m.referenceStudyUID, m.referenceSeriesUID) || {})
        .instances?.[0];
    if (inst) {
      return inst;
    }
  }

  // Fallback: walk the report's own evidence sequence.
  const evidence = toArray(naturalizedReport.CurrentRequestedProcedureEvidenceSequence)[0];
  const series = toArray(evidence && evidence.ReferencedSeriesSequence)[0];
  const sop = toArray(series && series.ReferencedSOPSequence)[0];

  if (!evidence || !series) {
    return undefined;
  }

  return (
    DicomMetadataStore.getInstance(
      evidence.StudyInstanceUID,
      series.SeriesInstanceUID,
      sop && sop.ReferencedSOPInstanceUID
    ) ||
    (DicomMetadataStore.getSeries(evidence.StudyInstanceUID, series.SeriesInstanceUID) || {})
      .instances?.[0]
  );
}

/**
 * onBeforeDicomStore customization.
 *
 * Called by @ohif/extension-cornerstone-dicom-sr's storeMeasurements command
 * with { dicomDict, measurementData, naturalizedReport }. Mutates dataset-level
 * attributes on the naturalized report, then builds and RETURNS a DicomDict so
 * the dicomweb data source writes our file meta (group 0002) instead of
 * rebuilding it with dcmjs defaults.
 */
function onBeforeDicomStore({ naturalizedReport, measurementData }) {
  const cfg = {
    ...DEFAULTS,
    ...((typeof window !== 'undefined' && window.config && window.config.nerotechSrTags) || {}),
  };

  let src;
  try {
    src = getSourceInstance(naturalizedReport, measurementData);
  } catch (e) {
    console.warn('[sr-tags] source instance lookup failed', e);
  }

  // --- Patient identity: copy from source (or force via config) ---
  const issuer = cfg.IssuerOfPatientID != null ? cfg.IssuerOfPatientID : src?.IssuerOfPatientID;
  if (issuer) {
    naturalizedReport.IssuerOfPatientID = issuer;
  }

  // --- General Equipment module: identifies the CREATOR of the SR ---
  const institution =
    cfg.InstitutionName != null ? cfg.InstitutionName : src?.InstitutionName;
  if (institution != null) {
    naturalizedReport.InstitutionName = institution;
  }
  naturalizedReport.Manufacturer = cfg.Manufacturer;
  naturalizedReport.ManufacturerModelName = cfg.ManufacturerModelName;
  naturalizedReport.DeviceSerialNumber = cfg.DeviceSerialNumber;
  naturalizedReport.SoftwareVersions = cfg.SoftwareVersions;

  // --- File meta (group 0002): build the DicomDict ourselves ---
  // Mirrors extensions/default DicomWebDataSource store.dicom, with our
  // Implementation attributes substituted.
  try {
    const meta = denaturalize({
      FileMetaInformationVersion:
        naturalizedReport._meta &&
        naturalizedReport._meta.FileMetaInformationVersion &&
        naturalizedReport._meta.FileMetaInformationVersion.Value,
      MediaStorageSOPClassUID: naturalizedReport.SOPClassUID,
      MediaStorageSOPInstanceUID: naturalizedReport.SOPInstanceUID,
      TransferSyntaxUID: cfg.TransferSyntaxUID,
      ImplementationClassUID: cfg.ImplementationClassUID,
      ImplementationVersionName: cfg.ImplementationVersionName,
    });

    const dicomDict = new DicomDict(meta);
    dicomDict.dict = denaturalize(naturalizedReport);
    return dicomDict; // store.dicom writes this verbatim
  } catch (e) {
    // If dict construction ever fails, fall back to default behavior rather
    // than blocking the save: dataset-level tags are already applied.
    console.error('[sr-tags] failed to build DicomDict, falling back', e);
    return undefined;
  }
}

export default {
  /**
   * Only required property. Should match the package name so the
   * customization module id resolves as
   * `@nerotech/extension-sr-tags.customizationModule.global`.
   */
  id: '@nerotech/extension-sr-tags',

  /**
   * Registered under name 'global' so the CustomizationService applies it
   * automatically at init for every mode — no app-config wiring required.
   */
  getCustomizationModule: () => [
    {
      name: 'global',
      value: {
        onBeforeDicomStore,
      },
    },
  ],
};
