const express = require("express");
const he = require("he");
const axios = require("axios");
const { find } = require("lodash");
const striptags = require("striptags");
const cors = require("cors");
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const app = express();
app.use(cors());
const PORT = process.env.PORT || 5000;

const fetchData = async (url) => {
  console.log(url)
  if (typeof fetch === "function") {
    const response = await fetch(url);
    return await response.text();
  } else {
    const { data } = await axios.get(url);
    return data;
  }
};

const getSubtitles = async ({ videoID, lang = "en" }) => {
  const data = await fetchData(`https://youtube.com/watch?v=${videoID}`);
  if (!data.includes("captionTracks"))
    throw new Error(`Could not find captions for video: ${videoID}`);

  const regex = /"captionTracks":(\[.*?\])/;
  const match = regex.exec(data);

  if (!match) {
    throw new Error(`Could not find captions for video: ${videoID}`);
  }

  const { captionTracks } = JSON.parse(`{"captionTracks":${match[1]}}`);
  const subtitle =
    find(captionTracks, { vssId: `.${lang}` }) ||
    find(captionTracks, { vssId: `a.${lang}` }) ||
    find(captionTracks, ({ vssId }) => vssId && vssId.match(`.${lang}`));
  if (!subtitle || (subtitle && !subtitle.baseUrl))
    throw new Error(`Could not find ${lang} captions for ${videoID}`);

  const transcript = await fetchData(subtitle.baseUrl);
  const lines = transcript
    .replace('<?xml version="1.0" encoding="utf-8" ?><transcript>', "")
    .replace("</transcript>", "")
    .split("</text>")
    .filter((line) => line && line.trim())
    .map((line) => {
      const startRegex = /start="([\d.]+)"/;
      const durRegex = /dur="([\d.]+)"/;

      const startMatch = startRegex.exec(line);
      const durMatch = durRegex.exec(line);

      if (!startMatch || !durMatch) {
        return null;
      }

      const [, start] = startMatch;
      const [, dur] = durMatch;

      const htmlText = line
        .replace(/<text.+>/, "")
        .replace(/&amp;/gi, "&")
        .replace(/<\/?[^>]+(>|$)/g, "");
      const decodedText = he.decode(htmlText);
      const text = striptags(decodedText);
      return { start, dur, text };
    })
    .filter((line) => line !== null);

  return lines;
};

app.get("/subtitles", async (req, res) => {
  const { videoID, lang } = req.query;

  if (!videoID) {
    return res.status(400).send({ error: "videoID is required" });
  }

  try {
    const subtitles = await getSubtitles({ videoID, lang });
    res.json(subtitles);
  } catch (error) {
    res.status(500).send({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
