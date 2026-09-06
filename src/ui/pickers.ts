// Hidden file inputs shared by every "Choose files" / "Choose folder" control on the page.

import { el } from "./dom";

export interface Pickers {
  pickFiles(): void;
  pickFolder(): void;
  destroy(): void;
}

export function createPickers(
  root: HTMLElement,
  onFiles: (files: FileList, kind: "files" | "folder") => void
): Pickers {
  const files = el("input", {
    type: "file",
    multiple: true,
    accept: ".json,application/json,application/schema+json",
    class: "se-visually-hidden",
    tabindex: "-1",
    "aria-hidden": "true"
  });
  const folder = el("input", {
    type: "file",
    multiple: true,
    webkitdirectory: true,
    class: "se-visually-hidden",
    tabindex: "-1",
    "aria-hidden": "true"
  });
  const wire = (input: HTMLInputElement, kind: "files" | "folder"): void => {
    input.addEventListener("change", () => {
      if (input.files && input.files.length > 0) onFiles(input.files, kind);
      input.value = "";
    });
  };
  wire(files, "files");
  wire(folder, "folder");
  root.append(files, folder);
  return {
    pickFiles: () => files.click(),
    pickFolder: () => folder.click(),
    destroy: () => {
      files.remove();
      folder.remove();
    }
  };
}
