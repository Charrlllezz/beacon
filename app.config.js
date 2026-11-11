// The pitch demo build (EXPO_PUBLIC_RNDVU_DEMO=1) leaves out the Find me
// lock-screen extension: the demo doesn't use it, and it needs its own
// provisioning profile. Demo branch only.
module.exports = ({ config }) => {
  if (process.env.EXPO_PUBLIC_RNDVU_DEMO !== '1') return config;
  return { ...config, plugins: config.plugins.filter(p => p !== '@bacons/apple-targets') };
};
