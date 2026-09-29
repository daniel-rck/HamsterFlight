// The pictures a link and a home screen show: the Open Graph card and the
// Apple touch icon, rendered from the real page rather than drawn by hand.
//
//   bun run build && bun run images
//
// Writes public/og.jpg (1200 x 630) and public/apple-touch-icon.png (180 x 180).
// Both are committed, so this runs only when the opening screen or the icon
// changes - not in CI, and not on every build.
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { intEnv, ROOT, run } from "./lib/cli.ts";
import { waitForBoot, withPreview } from "./lib/preview.ts";

const PORT = intEnv("PORT", 4175);
// A seed whose first sky reads well behind the card.
const SEED = intEnv("SEED", 7);

async function main(): Promise<void> {
  await withPreview(PORT, async (browser, origin) => {
    // 945 x 630 is exactly the 3:2 stage at the card's height, so the page
    // lays the opening screen out edge to edge with no bars.
    const page = await browser.newPage({
      viewport: { width: 945, height: 630 },
      deviceScaleFactor: 1,
    });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`${origin}/?seed=${SEED}&lang=en`, { waitUntil: "load" });
    await waitForBoot(page);
    await page.waitForSelector("#intro:not([hidden])");
    await page.evaluate(() => document.fonts.ready);
    // No focus ring on the card's picture.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await sleep(400);
    const stage = await page.locator(".stage").screenshot({ type: "png" });

    // 1200 x 630: the stage in the middle, and the same picture blurred and
    // darkened to fill the sides, so the card reads as one image.
    const card = await page.evaluate(
      async (source: string) => {
        const image = new Image();
        image.src = source;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = 1200;
        canvas.height = 630;
        const ctx = canvas.getContext("2d");
        if (ctx === null) throw new Error("no 2d context");
        const cover = 1200 / image.width;
        ctx.filter = "blur(24px) brightness(0.6)";
        ctx.drawImage(image, 0, (630 - image.height * cover) / 2, 1200, image.height * cover);
        ctx.filter = "none";
        ctx.shadowColor = "rgb(0 0 0 / 45%)";
        ctx.shadowBlur = 30;
        ctx.drawImage(image, (1200 - image.width) / 2, 0);
        return canvas.toDataURL("image/jpeg", 0.86);
      },
      `data:image/png;base64,${stage.toString("base64")}`,
    );
    await writeFile(join(ROOT, "public/og.jpg"), Buffer.from(card.split(",")[1] ?? "", "base64"));

    // The favicon, at the size iOS asks for, on an opaque background - iOS
    // fills transparency with black and rounds the corners itself.
    const icon = await page.evaluate(async () => {
      const image = new Image();
      image.src = "/favicon.svg";
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = 180;
      canvas.height = 180;
      const ctx = canvas.getContext("2d");
      if (ctx === null) throw new Error("no 2d context");
      ctx.fillStyle = "#1b2430";
      ctx.fillRect(0, 0, 180, 180);
      ctx.drawImage(image, 0, 0, 180, 180);
      return canvas.toDataURL("image/png");
    });
    await writeFile(
      join(ROOT, "public/apple-touch-icon.png"),
      Buffer.from(icon.split(",")[1] ?? "", "base64"),
    );
  });
  console.log("wrote public/og.jpg and public/apple-touch-icon.png");
}

run(main);
