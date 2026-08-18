import { useEffect, useRef } from "react";
import type { UpdateStatus } from "@shared/types";
import { api, unwrap } from "../lib/api";
import { useApp } from "../store";

/** One tag for the whole flow, so the offer, the ready card and any error replace each other. */
const TAG = "app-update";

/**
 * Turns update status into the two prompts the user is asked to answer: one when an update is
 * found at launch, one when it has finished downloading. Everything else — progress, errors,
 * retrying — stays on the About page, which this deliberately does not duplicate.
 */
export function UpdatePrompts() {
  const notify = useApp((state) => state.notify);
  const navigate = useApp((state) => state.navigate);
  // Prompts fire on entering a state, not on every progress tick within it.
  const lastPrompted = useRef("");

  useEffect(() => {
    const react = (status: UpdateStatus) => {
      const key = `${status.state}:${"version" in status ? status.version : ""}`;
      if (key === lastPrompted.current) return;

      if (status.state === "available") {
        lastPrompted.current = key;
        notify({
          kind: "info",
          tag: TAG,
          sticky: true,
          title: `InfinityPlay ${status.version} is available`,
          body: "Download it now? You can pause the transfer at any point.",
          actions: [
            { label: "Update now", primary: true, onClick: () => void api.updates.download() },
            { label: "Not now", onClick: () => void api.updates.decline() },
          ],
        });
        return;
      }

      if (status.state === "downloaded") {
        lastPrompted.current = key;
        notify({
          kind: "info",
          tag: TAG,
          sticky: true,
          title: `InfinityPlay ${status.version} is ready`,
          body: "Install now to update to the latest version, or install later from the About page.",
          actions: [
            { label: "Install now", primary: true, onClick: () => void api.updates.install() },
            { label: "Later", onClick: () => navigate({ name: "about" }) },
          ],
        });
        return;
      }

      lastPrompted.current = key;
    };

    unwrap(api.updates.status()).then(react).catch(() => undefined);
    return api.updates.onStatus(react);
  }, [notify, navigate]);

  return null;
}
