// metro.config.js
// Expo SDK 52 — enables tsconfig path aliases (@/* → src/*)
const { getDefaultConfig } = require('expo/metro-config');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

module.exports = config;
