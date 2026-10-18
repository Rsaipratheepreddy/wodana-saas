import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { baseSubject, htmlToText, isAutomatic, parseAddressList, parseMessageIds, replySubject, sanitizeEmailHtml, stripQuotedText, subjectKey } from "./email-content";
import { generateLocalPart, inboundDomain, inboundLocalParts, readMailgunInbound, verifyMailgunSignature } from "./mailgun-inbound";

describe("email content", () => {
  it("reads addresses with display names, quotes and commas", () => {
    expect(parseAddressList('"Haddad, Noura" <Noura@Example.com>, bob@x.io; not-an-address, Jane <jane@y.co>')).toEqual([
      { address: "noura@example.com", name: "Haddad, Noura" }, { address: "bob@x.io", name: null }, { address: "jane@y.co", name: "Jane" },
    ]);
  });

  it("reads Message-ID chains and keeps their brackets", () => {
    expect(parseMessageIds("<a@x> <b@y>\r\n <a@x>")).toEqual(["<a@x>", "<b@y>"]);
    expect(parseMessageIds("bare-id@host")).toEqual(["<bare-id@host>"]);
    expect(parseMessageIds("")).toEqual([]);
  });

  it("matches subjects across reply and forward prefixes", () => {
    expect(baseSubject("Re: FWD: AW: Kitchen quote")).toBe("Kitchen quote");
    expect(subjectKey("RE: Kitchen Quote")).toBe(subjectKey("Kitchen quote"));
    expect(replySubject("Re: Re: Kitchen quote", "Message")).toBe("Re: Kitchen quote");
    expect(replySubject("", "Message")).toBe("Re: Message");
  });

  it("keeps only the new part of a reply for the chat", () => {
    expect(stripQuotedText("Thursday works.\n\nOn Mon, 5 Oct 2026 at 10:00, Palm Living <x@y> wrote:\n> When can we visit?")).toBe("Thursday works.");
    expect(stripQuotedText("Yes please\r\n\r\nFrom: Palm Living\r\nSent: Monday\r\nTo: me\r\n\r\nOld text")).toBe("Yes please");
    expect(stripQuotedText("From: the start, this line is mine")).toBe("From: the start, this line is mine");
    expect(stripQuotedText("> only quoted")).toBe("> only quoted");
  });

  it("reduces HTML to safe formatting", () => {
    const html = `<html><head><style>p{}</style></head><body onload="x()"><p style="color:red" onclick="steal()">Hi <b>there</b></p>
      <script>alert(1)</script><img src="https://track/pixel.gif"><a href="javascript:alert(1)">bad</a><a href="https://palm.example/plan">plan</a>
      <iframe src="https://evil"></iframe><table><tr><td colspan="2" onmouseover="x">cell</td></tr></table>&lt;script&gt;<form><input name=a></form></body></html>`;
    const clean = sanitizeEmailHtml(html)!;
    expect(clean).not.toMatch(/script>|onclick|onload|style=|<img|javascript:|iframe|<form|<input|onmouseover/i);
    expect(clean).toContain("<p>Hi <b>there</b></p>");
    expect(clean).toContain('<a href="https://palm.example/plan" target="_blank" rel="noopener noreferrer nofollow">plan</a>');
    expect(clean).toContain('<td colspan="2">cell</td>');
    expect(clean).toContain("&lt;script&gt;");
    expect(sanitizeEmailHtml("<p>unclosed <b>bold")).toBe("<p>unclosed <b>bold</b></p>");
    expect(sanitizeEmailHtml("")).toBeNull();
  });

  it("reads the text of an HTML-only email", () => {
    expect(htmlToText("<p>Hello&nbsp;there</p><p>Line&#33;<br>Two</p>")).toBe("Hello there\nLine!\nTwo");
  });

  it("knows an automatic reply by its headers", () => {
    expect(isAutomatic(new Map([["auto-submitted", "auto-replied"]]))).toBe(true);
    expect(isAutomatic(new Map([["auto-submitted", "no"]]))).toBe(false);
    expect(isAutomatic(new Map([["precedence", "bulk"]]))).toBe(true);
  });
});

describe("Mailgun inbound", () => {
  const key = "key-signing-test";
  const sign = (timestamp: string, token: string) => createHmac("sha256", key).update(timestamp + token).digest("hex");
  const token = "a".repeat(50);

  it("accepts a fresh signature and refuses a wrong or stale one", () => {
    const now = 1_800_000_000;
    expect(verifyMailgunSignature({ timestamp: String(now), token, signature: sign(String(now), token) }, key, now)).toBe("valid");
    expect(verifyMailgunSignature({ timestamp: String(now), token, signature: sign(String(now), "b".repeat(50)) }, key, now)).toBe("invalid");
    expect(verifyMailgunSignature({ timestamp: String(now), token, signature: "zz" }, key, now)).toBe("invalid");
    expect(verifyMailgunSignature({ timestamp: String(now), token, signature: sign(String(now), token) }, "", now)).toBe("invalid");
    expect(verifyMailgunSignature({ timestamp: String(now - 9 * 3600), token, signature: sign(String(now - 9 * 3600), token) }, key, now)).toBe("stale");
    expect(verifyMailgunSignature({ timestamp: String(now + 3600), token, signature: sign(String(now + 3600), token) }, key, now)).toBe("stale");
  });

  it("makes unguessable addresses on the configured domain and reads them back", () => {
    const local = generateLocalPart("Palm-Living");
    expect(local).toMatch(/^palmliving-[a-z2-9]{10}$/);
    expect(generateLocalPart("")).toMatch(/^inbox-[a-z2-9]{10}$/);
    expect(new Set(Array.from({ length: 50 }, () => generateLocalPart("plm"))).size).toBe(50);
    expect(inboundDomain(" In.Wodana.AI ")).toBe("in.wodana.ai");
    expect(inboundDomain("not a domain")).toBeNull();
    expect(inboundLocalParts(`Someone <${local}@in.wodana.ai>, other@elsewhere.com, ${local}+tag@in.wodana.ai`, "in.wodana.ai")).toEqual([local, local]);
    expect(inboundLocalParts(`${local}@other.ai`, "in.wodana.ai")).toEqual([]);
  });

  it("reads a Route post: headers, threading ids, signature and files", () => {
    const email = readMailgunInbound({
      recipient: "plm-abcdefghij@in.wodana.ai", from: "Noura <noura@example.com>", subject: "Re: Villa", "body-plain": "Thursday\n\nOn Mon, X wrote:\n> hi",
      "stripped-text": "Thursday", "body-html": "<p>Thursday</p>", timestamp: "1800000000", token, signature: "f".repeat(64),
      "message-headers": JSON.stringify([["Message-Id", "<n1@example.com>"], ["In-Reply-To", "<m.1@in.wodana.ai>"], ["References", "<a@x> <m.1@in.wodana.ai>"], ["To", "info@palm.example"], ["Cc", "Ali <ali@example.com>"]]),
    }, [{ fieldname: "attachment-1", originalname: "plan.pdf", mimetype: "application/pdf", buffer: Buffer.from("%PDF-1.4") }, { fieldname: "other", buffer: Buffer.from("x") }]);
    expect(email).toMatchObject({ from: { address: "noura@example.com", name: "Noura" }, subject: "Re: Villa", strippedText: "Thursday", messageId: "<n1@example.com>",
      inReplyTo: ["<m.1@in.wodana.ai>"], references: ["<a@x>", "<m.1@in.wodana.ai>"], to: [{ address: "info@palm.example", name: null }], cc: [{ address: "ali@example.com", name: "Ali" }],
      signature: { timestamp: "1800000000", token } });
    expect(email.attachments.map((file) => file.fileName)).toEqual(["plan.pdf"]);
  });
});
