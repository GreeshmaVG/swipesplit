# SwipeSplit — Browser-Based Video Carousel Splitter

**SwipeSplit** is a completely client-side web application that allows users to split wide panoramic videos into multiple equally-sized segments, perfect for Instagram carousel posts.

## Key Features

- **No Server Uploads**: Processing happens locally in your browser. Your videos never leave your device.
- **Privacy First**: No tracking, no cookies, no account required.
- **Instagram Ready**: Automatically suggests the best number of slides for a 4:5 aspect ratio.
- **High Quality**: Uses FFmpeg WebAssembly to maintain original video quality.
- **Download as ZIP**: Get all your slices in one click.

## Tech Stack

- **Frontend**: React, Vite, TailwindCSS
- **Processing**: FFmpeg.wasm (@ffmpeg/ffmpeg)
- **Utilities**: JSZip, FileSaver.js, Lucide React

## Deployment (GitHub Pages)

SwipeSplit is pre-configured for GitHub Pages using `coi-serviceworker` to enable the required security headers.

1.  **Initialize Git**:
    ```bash
    git init
    git add .
    git commit -m "Initial commit"
    ```
2.  **Add your GitHub repo**:
    ```bash
    git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git
    ```
3.  **Deploy**:
    ```bash
    npm run deploy
    ```
    This will automatically build the project and push it to a `gh-pages` branch.

## Development

```bash
npm install
npm run dev
```

The dev server is configured in `vite.config.js` to provide the necessary cross-origin isolation headers.

## License

MIT
