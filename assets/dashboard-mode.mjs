// Published builds always force public mode, even when served on localhost.
export function privateDashboard(location, forcedMode = '') {
  return forcedMode !== 'public' && ['localhost','127.0.0.1','[::1]'].includes(location.hostname)
    && new URLSearchParams(location.search).get('view') !== 'public';
}
