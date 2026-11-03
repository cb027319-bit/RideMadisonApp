// expo-task-manager's config plugin always adds "fetch" to UIBackgroundModes.
// Ride Madison only needs "location" and "audio" (turn-by-turn while the phone is locked),
// and App Review questions background modes an app doesn't use, so take "fetch" back out.
const { withInfoPlist } = require('expo/config-plugins');

module.exports = function withoutBackgroundFetch(config) {
  return withInfoPlist(config, (cfg) => {
    const modes = cfg.modResults.UIBackgroundModes;
    if (Array.isArray(modes)) cfg.modResults.UIBackgroundModes = modes.filter((m) => m !== 'fetch');
    return cfg;
  });
};
