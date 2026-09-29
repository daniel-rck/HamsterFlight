import { describe, expect, it } from "vitest";
import { shareLink } from "@/app/share.ts";

const named = (name: string): Error => Object.assign(new Error(name), { name });
const url = "https://example.test/?run=abc";

describe("shareLink", () => {
  it("uses the share sheet where there is one", async () => {
    const shared: ShareData[] = [];
    const outcome = await shareLink(
      { share: async (d) => void shared.push(d), writeText: async () => undefined },
      url,
      "beat me",
    );
    expect(outcome).toBe("shared");
    expect(shared[0]).toEqual({ title: "HamsterFlight", text: "beat me", url });
  });

  it("stops at the player's own cancel", async () => {
    let copied = false;
    const outcome = await shareLink(
      {
        share: async () => Promise.reject(named("AbortError")),
        writeText: async () => void (copied = true),
      },
      url,
      "",
    );
    expect(outcome).toBe("cancelled");
    expect(copied).toBe(false);
  });

  it("falls back to the clipboard when the sheet refuses", async () => {
    let copied = "";
    const outcome = await shareLink(
      {
        share: async () => Promise.reject(named("NotAllowedError")),
        writeText: async (t) => void (copied = t),
      },
      url,
      "",
    );
    expect(outcome).toBe("copied");
    expect(copied).toBe(url);
  });

  it("asks the page to show the link when nothing else works", async () => {
    expect(await shareLink({}, url, "")).toBe("manual");
    expect(
      await shareLink({ writeText: async () => Promise.reject(named("NotAllowedError")) }, url, ""),
    ).toBe("manual");
  });
});
