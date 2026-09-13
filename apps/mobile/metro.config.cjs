const { getDefaultConfig } = require('expo/metro-config');
const { createAuthProxy } = require('./scripts/auth-proxy.cjs');

const config = getDefaultConfig(__dirname);
// Reuse the portal's pure field contracts/serializers; native dependencies resolve locally.
const path = require('node:path');
config.watchFolders = [...(config.watchFolders ?? []), path.resolve(__dirname, '../web/lib/pre-project')];
config.resolver.nodeModulesPaths = [path.resolve(__dirname, 'node_modules'), path.resolve(__dirname, '../../node_modules')];
const prior = config.server.enhanceMiddleware;
const proxy = createAuthProxy({ target: process.env.MOBILE_AUTH_PROXY_TARGET ?? process.env.EXPO_PUBLIC_AUTH_API_URL ?? 'http://127.0.0.1:8000/api/v1' });
config.server.enhanceMiddleware = (middleware, server) => {
  const enhanced = prior ? prior(middleware, server) : middleware;
  return (request, response, next) => {
    void proxy(request, response, () => enhanced(request, response, next)).catch(next);
  };
};
module.exports = config;
