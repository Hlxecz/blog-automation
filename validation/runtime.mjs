import { app } from 'electron';

// Hosted CI machines may have no usable GPU for offscreen screenshots.
// Keep software rendering confined to validation; production uses its defaults.
if (process.env.CI === 'true') app.disableHardwareAcceleration();
