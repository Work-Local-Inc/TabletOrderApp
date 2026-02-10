const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Disable Hermes bytecode on web
config.transformer.unstable_transformProfile = undefined;

module.exports = config;
