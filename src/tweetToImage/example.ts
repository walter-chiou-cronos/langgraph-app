import "dotenv/config";
import { tweetToImageGraph, ART_STYLE } from "./index";
import { writeImageToDisk } from "./utils/utils";

const wait = (delay = 5000) =>
  new Promise((resolve) => setTimeout(resolve, delay));

const tweets = [
  `Feeling like a kid in a candy store, riding the waves of the market with pure joy.`,
  `Can Cronos Chain's play-to-earn model revolutionize the gaming industry, making it more lucrative for players and devs alike, or is it just a fleeting trend? ( ̄▽ ̄)ノ #CronosChain`,
];

const main = async () => {
  const diagram = await tweetToImageGraph.getGraphAsync().then((g) =>
    g.drawMermaid({
      withStyles: true,
    })
  );
  console.log(diagram);

  const content = tweets[1];
  const shouldRemoveBranding = true;

  const baseFileName = `tweet-image-${Date.now()}`;

  // Iterate over all available art styles
  for (const artStyle of Object.keys(ART_STYLE) as Array<
    keyof typeof ART_STYLE
  >) {
    // Invoke the image generation function with the selected parameters
    const { images } = await tweetToImageGraph.invoke({
      tweet: content,
      artStyle: ART_STYLE[artStyle],
      shouldRemoveBranding,
      aspectRatio: "1:1",
    });

    const image = images?.[0];

    if (image) {
      const buffer = Buffer.from(image.image, "base64");
      const fileExtension = image.mimeType.split("/")[1];
      const fileName = `${baseFileName}_${artStyle}_${
        shouldRemoveBranding ? "remove_branding" : ""
      }.${fileExtension}`.toLocaleLowerCase();
      await writeImageToDisk(fileName, buffer);
      console.log(`Image saved as: ${fileName}`);
    } else {
      console.log("No image generated.");
    }
    await wait(5000);
  }
};

main().catch(console.error);
