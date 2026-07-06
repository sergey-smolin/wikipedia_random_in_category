# Random Wiki in Category

A Chrome extension that opens a random Wikipedia article from a specified category (including all its subcategories).

## Features

- **Category-based random articles**: Set any Wikipedia category and get random articles from it
- **Recursive subcategory expansion**: Automatically explores subcategories to find articles
- **Caching**: Caches category trees locally to minimize API calls and speed up subsequent uses
- **Rate limiting**: Limit consecutive requests to 1 request/second, to save the API resources
- **Persistent storage**: Remembers your last used category between sessions
- **Keyboard shortcut**: `Ctrl+Shift+2` (Windows/Linux) or `Cmd+Shift+2` (Mac) to open random article instantly

## Installation

### From Chrome Web Store
*Coming soon...* (TODO)

### Manual Installation (Developer Mode)
1. Clone or download this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" (top right toggle)
4. Click "Load unpacked" and select the project directory
5. The extension icon will appear in your toolbar

## Usage

1. Click the extension icon in your toolbar
2. Enter a Wikipedia category name (without "Category:" prefix)
   - Examples: `Physics`, `Computer science`, `History of Europe`, `Science fiction novels`
3. Click "Set Category" or press Enter
4. Click "Open Random Page" to get a random article from that category
5. Use `Ctrl+Shift+2` anytime to quickly open another random article from the same category

## How It Works

1. **Category Tree Building**: When you set a category, the extension fetches all pages and subcategories
2. **Recursive Expansion**: When a subcategory is randomly selected, it's expanded by fetching more subcategories to reveal its contents
3. **Intelligent Caching**: Category trees are stored in `chrome.storage.local` for instant access
4. **Random Selection**: Picks uniformly from all known pages in the category tree
5. **Fallback Strategy**: If API limits are reached, selects from already-cached pages

## Technical Details

### Architecture
- **Manifest V3** service worker (`background.js`)
- **Popup UI** (`popup.html` + `popup.js`)
- **Wikipedia API** integration with proper rate limiting
- **Chrome Storage API** for persistence

### API Usage
- Uses `action=query&list=categorymembers` endpoint
- Handles pagination with `cmcontinue`
- Respects `Retry-After` headers on 429 responses
- User-Agent: `RandomWikiInCategory/1.0 (https://github.com/sergey-smolin/random-wiki-in-category)`

### Storage Structure
- Converts items into a format compatible with Chrome storage
