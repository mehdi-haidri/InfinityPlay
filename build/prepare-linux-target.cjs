const fs = require("node:fs/promises");
const path = require("node:path");

exports.default = async function prepareLinuxTarget(event) {
  if (event.targetPresentableName !== "pacman") return;

  // electron-updater selects its Linux installer from this marker. electron-builder 25
  // writes it for DEB/RPM but not pacman, even though electron-updater supports pacman.
  // FPM targets run serially, so writing immediately before pacman packages the already
  // prepared app cannot affect the preceding DEB or RPM artifacts.
  const resources = path.join(path.dirname(event.file), "linux-unpacked", "resources");
  await fs.mkdir(resources, { recursive: true });
  await fs.writeFile(path.join(resources, "package-type"), "pacman\n");
};
