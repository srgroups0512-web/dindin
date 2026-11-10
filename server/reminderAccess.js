export function reminderRuntimeAccess({
  nodeEnv,
  allowDevelopmentPreview,
  scheduleDevelopmentPreview,
  entitlementActive,
}) {
  if (nodeEnv !== 'production') return true;
  if (allowDevelopmentPreview && scheduleDevelopmentPreview) return true;
  return entitlementActive === true;
}
