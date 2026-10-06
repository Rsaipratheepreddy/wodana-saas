import { describe, expect, it } from "vitest";
import { inOverlay, isTypingTarget, shortcutBlocked } from "./typing-target";

const html = (markup: string) => { document.body.innerHTML = markup; return (selector: string) => document.querySelector(selector)!; };

describe("where a key press belongs (L18)", () => {
  it("treats text fields, editable regions, comboboxes and search fields as typing", () => {
    const $ = html(`<input id="text"><input id="box" type="checkbox"><textarea id="area"></textarea><div id="edit" contenteditable="true"><b id="inside">x</b></div>
      <div role="combobox" id="combo"></div><div role="searchbox" id="search"></div><button id="button">Go</button>`);
    for (const id of ["text", "area", "inside", "combo", "search"]) expect(isTypingTarget($(`#${id}`))).toBe(true);
    for (const id of ["box", "button"]) expect(isTypingTarget($(`#${id}`))).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });

  it("leaves keys in dialogs and side panels to them", () => {
    const $ = html(`<div role="dialog"><button id="in-dialog">x</button></div><aside data-side-panel><input id="panel-search" type="search"></aside><main><button id="page">x</button></main>`);
    expect(inOverlay($("#in-dialog"))).toBe(true);
    expect(shortcutBlocked({ target: $("#panel-search"), defaultPrevented: false })).toBe(true);
    expect(shortcutBlocked({ target: $("#page"), defaultPrevented: false })).toBe(false);
    expect(shortcutBlocked({ target: $("#page"), defaultPrevented: true })).toBe(true);
  });
});
