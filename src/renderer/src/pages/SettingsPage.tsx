import { useState } from "react";
import { useApp } from "../store";
import { PageHeader } from "../components/PageHeader";
import { AppearanceSection } from "./settings/AppearanceSection";
import { PlaybackSection } from "./settings/PlaybackSection";
import { SubtitleSettingsSection } from "./settings/SubtitleSettingsSection";
import { IptvSection } from "./settings/IptvSection";
import { ApiSection } from "./settings/ApiSection";
import { ParentalControlsSection } from "./settings/ParentalControlsSection";
import { DataManagementSection } from "./settings/DataManagementSection";

export function SettingsPage() {
  const config = useApp((state) => state.config);
  const patchConfig = useApp((state) => state.patchConfig);
  const notify = useApp((state) => state.notify);
  const [restartNeeded, setRestartNeeded] = useState(false);

  return (
    <div className="page page-narrow">
      <PageHeader
        eyebrow="Preferences"
        title="Settings"
        description="Control catalog, playback, subtitles, downloads, and live TV sources."
      />

      <AppearanceSection config={config} patchConfig={patchConfig} />

      <PlaybackSection
        config={config}
        patchConfig={patchConfig}
        restartNeeded={restartNeeded}
        setRestartNeeded={setRestartNeeded}
      />

      <ParentalControlsSection config={config} patchConfig={patchConfig} notify={notify} />

      <SubtitleSettingsSection config={config} patchConfig={patchConfig} />

      <IptvSection config={config} patchConfig={patchConfig} notify={notify} />

      <ApiSection config={config} patchConfig={patchConfig} notify={notify} />

      <DataManagementSection />
    </div>
  );
}
