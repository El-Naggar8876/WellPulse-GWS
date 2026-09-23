/* WellPulse GWS – deployment configuration.
 * Edit API_URL after deploying the Apps Script backend (see backend/README.md).
 * For testing, these can be overridden via URL params: ?api=...&token=...
 */
window.WP_CONFIG = {
  APP_NAME: 'WellPulse GWS-SENCE',
  APP_VERSION: '1.1.0',
  // Apps Script Web App URL (ends with /exec). Leave empty until deployed.
  API_URL: 'https://script.google.com/macros/s/AKfycbwd-libdKQm1InaITlSUZQ9bThLm_dQP_nmgY2FhS9c7r3sGajdVjIOqJ282z0fv0PQ/exec',
  // Shared project token; must match TOKEN in backend/Code.gs.
  API_TOKEN: 'gws-2026',
  DEFAULT_LANG: 'ar',
  // Validation limits. soft = warn and ask to confirm; hard = block.
  // The groundwater expert's exact rules go here, or in the Config sheet (which overrides these when online).
  LIMITS: {
    ec:   { softMin: 0.1, softMax: 15, hardMin: 0,  hardMax: 100 },   // in mS/cm
    temp: { softMin: 10,  softMax: 40, hardMin: -5, hardMax: 60 }     // in °C
  },
  // Warn if the new EC differs from the previous reading of the same well by more than this fraction.
  JUMP_FRACTION: 0.5,
  EC_UNITS: ['mS/cm', 'dS/m', 'µS/cm'],
  DEFAULT_EC_UNIT: 'mS/cm',
  // Whether the handheld meter already reports EC compensated to 25 °C (null = unknown).
  METER_COMPENSATED: null,
  PHOTO_MAX_PX: 1024,
  PHOTO_QUALITY: 0.6,
  GPS_TIMEOUT_MS: 15000
};
