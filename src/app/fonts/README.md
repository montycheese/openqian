# Bundled fonts

All fonts are licensed under the SIL Open Font License 1.1 (license texts alongside) and are served by the app itself — no requests to font services.

| File | Font | Notes |
|---|---|---|
| `PixelifySans.woff2` | [Pixelify Sans](https://github.com/googlefonts/pixelify-sans) (variable weight) | Interface text. Subset to Latin-1 plus common punctuation and arrows. |
| `Silkscreen-Regular.woff2` | [Silkscreen](https://github.com/googlefonts/silkscreen) | Numbers. Subset to Latin-1. |
| `ZCOOLQingKeHuangYou-subset.woff2` | [ZCOOL QingKe HuangYou](https://github.com/googlefonts/zcool-qingke-huangyou) | Chinese labels. Subset to only the characters the app uses. |

When adding Chinese text, regenerate the subset with every character used in `src/`:

```sh
pip install fonttools brotli
pyftsubset ZCOOLQingKeHuangYou-Regular.ttf --text="<characters>" --flavor=woff2 --output-file=ZCOOLQingKeHuangYou-subset.woff2
```
