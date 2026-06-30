// ── Get Current Location Skill ───────────────────────────────
// Retrieves the user's geographical location via browser
// Geolocation API. Gracefully handles permission denial
// and missing API support.

import type { Skill, SkillResult, SkillContext } from "./skill_registry";

async function execute(
  _args: Record<string, unknown>,
  _context: SkillContext,
): Promise<SkillResult> {
  // Check if geolocation API is available
  if (!navigator || !navigator.geolocation) {
    return {
      success: false,
      data: null,
      error: "Geolocation API is not available in this environment (Obsidian desktop app may not support it)",
    };
  }

  try {
    const position = await new Promise<GeolocationPosition>((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        resolve,
        (err) => {
          switch (err.code) {
            case err.PERMISSION_DENIED:
              reject(new Error("Location permission denied by user"));
              break;
            case err.POSITION_UNAVAILABLE:
              reject(new Error("Location information is unavailable"));
              break;
            case err.TIMEOUT:
              reject(new Error("Location request timed out"));
              break;
            default:
              reject(new Error(`Geolocation error: ${err.message}`));
          }
        },
        {
          enableHighAccuracy: false, // don't need GPS precision
          timeout: 10_000,           // 10 second timeout
          maximumAge: 300_000,        // accept cached position up to 5 min old
        },
      );
    });

    return {
      success: true,
      data: {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
        timestamp: position.timestamp,
      },
    };
  } catch (e: any) {
    return {
      success: false,
      data: null,
      error: e?.message || "Unknown geolocation error",
    };
  }
}

export const getCurrentLocationSkill: Skill = {
  name: "get_current_location",
  description: "获取用户当前地理位置（经纬度、精度）。需要浏览器定位权限。",
  permissions: "privileged",
  execute,
};
