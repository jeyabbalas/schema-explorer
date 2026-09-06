import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mountTestApp, texts, until, type TestApp } from "./helpers/dom";
import { installExamplesFetch } from "./helpers/examples";

describe("app smoke test", () => {
  let app: TestApp;

  beforeEach(() => {
    installExamplesFetch();
    app = mountTestApp();
  });

  afterEach(() => {
    app.destroy();
    vi.unstubAllGlobals();
  });

  it("loads the examples into five dataset cards and lets the user manage them", async () => {
    await app.actions.boot();
    const root = app.root;
    expect(root.querySelector(".se-empty")?.hasAttribute("hidden")).toBe(false);

    const button = root.querySelector<HTMLButtonElement>(".se-empty [data-action='load-examples']");
    expect(button).not.toBeNull();
    button?.click();
    await until(() => root.querySelectorAll(".se-card").length === 5, 20_000, "five cards");
    await until(() => app.store.get().busy === undefined, 5_000, "idle");

    expect(texts(root, ".se-chip__label")).toEqual([
      "BGS",
      "MWS",
      "OFH · participant",
      "OFH · questionnaire",
      "TARGET"
    ]);
    expect(texts(root, ".se-chip__count")).toEqual(["60", "38", "14", "359", "5"]);
    expect(root.querySelector(".se-empty")?.hasAttribute("hidden")).toBe(true);
    expect(root.querySelector(".se-shelf")?.hasAttribute("hidden")).toBe(false);

    // Each card hosts the library component with its rendered dictionary in a shadow root.
    for (const card of Array.from(root.querySelectorAll(".se-card"))) {
      const component = card.querySelector("json-data-dictionary");
      expect(component?.shadowRoot?.querySelector(".dd-root")).not.toBeNull();
      expect(card.getAttribute("data-ds")).toMatch(/^[1-8]$/);
    }
    const hues = Array.from(root.querySelectorAll(".se-card")).map((card) => card.getAttribute("data-ds"));
    expect(new Set(hues).size).toBe(5);

    // The footer carries the build information.
    expect(root.querySelector(".se-footer")?.textContent).toContain(__COMMIT__);

    // Remove a dataset, then undo it from the toast.
    root.querySelector<HTMLButtonElement>(".se-chip__remove")?.click();
    await until(() => root.querySelectorAll(".se-card").length === 4, 5_000, "four cards");
    const undo = root.querySelector<HTMLButtonElement>(".se-toast [data-action='undo']");
    expect(undo).not.toBeNull();
    undo?.click();
    await until(() => root.querySelectorAll(".se-card").length === 5, 5_000, "five cards again");
    expect(texts(root, ".se-chip__label")[0]).toBe("BGS");

    // Rename and collapse.
    const first = app.store.get().datasets[0];
    if (!first) throw new Error("no dataset");
    app.actions.renameDataset(first.id, "Generations");
    expect(texts(root, ".se-chip__label")[0]).toBe("Generations");
    expect(root.querySelector(".se-card .se-card__label")?.textContent).toBe("Generations");
    app.actions.setAllCardsCollapsed(true);
    expect(
      Array.from(root.querySelectorAll(".se-card")).every(
        (card) => card.getAttribute("data-collapsed") === "true"
      )
    ).toBe(true);

    // Loading the examples again is a no-op with a notice.
    await app.actions.loadExamples();
    expect(root.querySelectorAll(".se-card").length).toBe(5);
    expect(app.store.get().notices.some((notice) => notice.text.includes("already loaded"))).toBe(true);

    // Search across every dataset.
    app.actions.setAllCardsCollapsed(false);
    const input = root.querySelector<HTMLInputElement>(".se-search__input");
    if (!input) throw new Error("no search input");
    expect(root.querySelector(".se-search")?.hasAttribute("hidden")).toBe(false);
    app.actions.setQuery("smoking");
    await until(() => !(root.querySelector("#se-results")?.hasAttribute("hidden") ?? true), 5_000, "results");
    expect(root.querySelectorAll(".se-group").length).toBeGreaterThanOrEqual(3);
    expect(root.querySelectorAll(".se-strip__cell").length).toBe(5);
    expect(root.querySelector("#se-summary")?.textContent).toMatch(/^Found in \d of 5 datasets/);
    expect(root.querySelectorAll(".se-row mark.se-mark").length).toBeGreaterThan(0);

    // Jump into a dictionary: the card's own search box is driven to the variable.
    const jump = root.querySelector<HTMLButtonElement>(".se-group[data-ds] .se-row__name");
    const jumpName = jump?.querySelector("code")?.textContent ?? "";
    jump?.click();
    const targetCard = Array.from(root.querySelectorAll(".se-card")).find(
      (card) => !card.querySelector(".se-card__filter")?.hasAttribute("hidden")
    );
    expect(targetCard).toBeDefined();
    expect(targetCard?.querySelector(".se-card__filter code")?.textContent).toBe(jumpName);
    const box = targetCard
      ?.querySelector("json-data-dictionary")
      ?.shadowRoot?.querySelector<HTMLInputElement>("[data-dd-search]");
    expect(box?.value).toBe(jumpName);
    expect(app.store.get().ui.announcement).toContain(jumpName);

    // Export and clear.
    expect(app.actions.exportResultsCsv()?.split("\r\n")[0]).toMatch(/^Dataset,Variable/);
    app.actions.setQuery("");
    expect(root.querySelector("#se-results")?.hasAttribute("hidden")).toBe(true);

    // Clear everything.
    await app.actions.clearAll();
    expect(root.querySelectorAll(".se-card").length).toBe(0);
    expect(root.querySelector(".se-empty")?.hasAttribute("hidden")).toBe(false);
  });

  it("reports a selection without schemas", async () => {
    await app.actions.boot();
    const file = new File(["not json"], "notes.txt", { type: "text/plain" });
    await app.actions.addFiles([file]);
    const notice = app.store.get().notices[0];
    expect(notice?.level).toBe("error");
    expect(notice?.text).toContain("No .json files found");
    expect(app.root.querySelector(".se-toast[data-kind='error']")).not.toBeNull();
  });
});
