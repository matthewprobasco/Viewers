# @nerotech/extension-sr-tags

OHIF extension that customizes DICOM SR objects created by the measurement
tracking workflow (`@ohif/extension-cornerstone-dicom-sr`):

- Copies **IssuerOfPatientID (0010,0021)** from the source image into the SR
  (or forces a fixed value via config)
- Sets the **General Equipment module**: Manufacturer, ManufacturerModelName,
  InstitutionName, DeviceSerialNumber, SoftwareVersions
- Writes custom **file meta**: ImplementationClassUID (0002,0012) and
  ImplementationVersionName (0002,0013), by returning a fully-built DicomDict
  from the `onBeforeDicomStore` customization

Because `dcmjs` and `@ohif/core` are **peer dependencies**, the extension always
uses the exact versions bundled with your OHIF build. Nothing to re-pin when you
upgrade OHIF.

Verified against OHIF Viewers **v3.12.8** (`onBeforeDicomStore` contract in
`extensions/cornerstone-dicom-sr/src/commandsModule.ts`).

## Install (local link, recommended)

From your Viewers repo root:

```bash
yarn run cli link-extension /path/to/nerotech-extension-sr-tags
yarn install
yarn dev        # or your production build command
```

`link-extension` adds the package to `platform/app/pluginConfig.json` and
yarn-links it. To remove: `yarn run cli unlink-extension @nerotech/extension-sr-tags`.

Manual alternative: add to `platform/app/pluginConfig.json`:

```json
{ "extensions": [ { "packageName": "@nerotech/extension-sr-tags" } ] }
```

and make the package resolvable (workspace folder, `yarn link`, or private
registry).

No mode changes and no `customizationService` block in app-config are needed —
the customization is registered at **global** scope automatically.

> If you still have the previous `customizationService.onBeforeDicomStore`
> function in app-config.js, REMOVE it. Config-defined customizations are
> global scope too and would override this extension.

## Runtime configuration (no rebuild)

All values can be overridden in `app-config.js`:

```js
window.config = {
  // ...
  nerotechSrTags: {
    Manufacturer: 'Nerotech Solutions LLC',
    ManufacturerModelName: 'NeroArchiveWEB VIEW SR Writer',
    DeviceSerialNumber: 'NT-001',
    SoftwareVersions: '1.2.0',
    ImplementationClassUID: '1.2.826.0.1.xxxxxxx.1.1', // use your org root
    ImplementationVersionName: 'NEROTECH_1.2',          // SH VR, max 16 chars

    // null (default) = copy from the source image instance.
    // A string = always use that fixed value.
    IssuerOfPatientID: null,
    InstitutionName: null,
  },
};
```

Replace the placeholder ImplementationClassUID default with a UID under a root
registered to your organization before production use.

## Upgrading OHIF

1. Update the Viewers checkout / version.
2. `yarn install && yarn build`.
3. Sanity-check that `onBeforeDicomStore` still exists and still accepts
   `{ dicomDict, measurementData, naturalizedReport }` and passes the return
   value to `dataSource.store.dicom(...)`:
   `extensions/cornerstone-dicom-sr/src/commandsModule.ts` (storeMeasurements)
   and `extensions/default/src/DicomWebDataSource/index.ts` (store.dicom).

## Verify

Save a measurement SR, retrieve it, and dump:

```bash
dcmdump saved-sr.dcm | grep -E "0002,0012|0002,0013|0010,0021|0008,0070|0008,1090|0008,0080|0018,1000|0018,1020"
```

Expected: your Implementation UID/version in group 0002, IssuerOfPatientID
populated, and your equipment values. If (0010,0021) is empty, check whether
your archive returns it in WADO-RS `/metadata` — the viewer cannot copy what it
never received; fix belongs server-side (e.g. dcm4chee-arc issuer supplement).
