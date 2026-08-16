import { useEffect, useState } from "react";
import type { DeviceProfile } from "../lib/device";

/**
 * The current device shape, kept up to date as the window changes.
 *
 * `applyDeviceProfile` writes the profile onto the root element, and most of the app reacts to it
 * through CSS. A component that reads `dataset.device` during render instead gets whatever the
 * value was on its first render and never hears about a change — so rotating a tablet, or dragging
 * a desktop window narrow enough to cross the phone breakpoint, left it showing the wrong variant.
 */
export function useDeviceProfile(): DeviceProfile {
  const read = (): DeviceProfile =>
    (document.documentElement.dataset.device as DeviceProfile | undefined) ?? "desktop";

  const [profile, setProfile] = useState<DeviceProfile>(read);

  useEffect(() => {
    // The attribute is rewritten by the resize handler that owns the profile, so observing the
    // element catches every change without duplicating that breakpoint logic here.
    const observer = new MutationObserver(() => setProfile(read()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-device"] });
    setProfile(read());
    return () => observer.disconnect();
  }, []);

  return profile;
}
