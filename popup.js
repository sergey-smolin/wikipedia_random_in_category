// TODO: handle local storage of all fetched subtrees
import { API_USER_AGENT } from './config.js';

let cachedList = [];
let currentRoot;
let currentCategory;
const categoriesMap = new Map();

/* -------------------------------------------------------------------------- */
/*  UI elements                                                               */
/* -------------------------------------------------------------------------- */

// TODO: need to store the category in a variable also
const categoryInput = document.getElementById("categoryInput");
const setBtn = document.getElementById("setCategoryBtn");
const randomBtn = document.getElementById("randomBtn");
const debugBox = document.getElementById("debugBox");

/*  API helper – throttling, retry‑after handling, continuation support       */
/* -------------------------------------------------------------------------- */

const RATE_LIMIT_MS = 1000; // 1 request per second as recommended by Wikipedia
let lastRequestTimestamp = 0;

/**
 * Performs a fetch respecting rate‑limit and handling HTTP 429 with Retry‑After.
 * @param {string} url
 * @param {object} [options={}]
 * @returns {Promise<Response>}
 */
async function throttledFetch(url, options = {}) {
  // Enforce minimum interval between requests
  const now = Date.now();
  const elapsed = now - lastRequestTimestamp;
  if (elapsed < RATE_LIMIT_MS) {
    await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_MS - elapsed));
  }
  lastRequestTimestamp = Date.now();

  console.log('API request: ', url, new Date());

  const resp = await fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      "Api-User-Agent": API_USER_AGENT,
    },
  });

  // If we are rate‑limited, respect the Retry‑After header and retry once
  if (resp.status === 429) {
    console.log('Rate limited: 429 status')
    const retryAfter = parseInt(resp.headers.get("Retry-After"), 10) || 5;
    await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
    return throttledFetch(url, options);
  }

  return resp;
}

/* -------------------------------------------------------------------------- */
/*  Category handling & caching                                               */
/* -------------------------------------------------------------------------- */

function loadSelectedCategory() {
  chrome.storage.local.get(["wikiRandomCategory"], (result) => {
    if (result.wikiRandomCategory) {
      categoryInput.value = result.wikiRandomCategory;
      setBtn.click(); // initialise the cache for the stored category
    }
  });
}

/**
 * Saves the currently‑selected category so it survives popup reloads.
 * @param {string} category
 */
function storeCategory(category) {
  chrome.storage.local.set({ wikiRandomCategory: category }, () => {
    if (chrome.runtime.lastError) {
      console.warn('Failed to store category:', chrome.runtime.lastError);
    } else {
      console.log('Category stored for next session:', category);
    }
  });
}

/**
 * Saves the categoriesMap to chrome.storage.local.
 */
function saveCategoriesMapToStorage() {
  // Convert Map to array of [key, value] pairs for serialization
  let mapArray = []

  categoriesMap.set(currentCategory.toLowerCase(), currentRoot)
  for (const categoryTree of categoriesMap.entries()) {
    const categoryTreeArray = []
    for (const item of categoryTree[1]) {
      categoryTreeArray.push(item)
    }
    mapArray.push([categoryTree[0], categoryTreeArray])
  }
  console.log('Saving to storage: ', mapArray)
  chrome.storage.local.set({ wikiRandomCategoriesMap: mapArray }, () => {
    if (chrome.runtime.lastError) {
      console.warn('Failed to store categories map:', chrome.runtime.lastError);
    } else {
      console.log('Categories map saved to storage');
    }
  });
}

/**
 * Loads the categoriesMap from chrome.storage.local.
 */
function loadCategoriesMap() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['wikiRandomCategoriesMap'], (result) => {
      if (result.wikiRandomCategoriesMap) {
        categoriesMap.clear();
        for (const [key, categoryArray] of result.wikiRandomCategoriesMap) {
          const categoryTree = new Map();
          for (const [key, categoryLevel] of categoryArray) {
            categoryTree.set(key, categoryLevel)
          }
          categoriesMap.set(key, categoryTree);
        }
        console.log('Categories map loaded from storage, entries:', categoriesMap);
      }
      resolve();
    });
  });
}

/**
 * Fetches *all* members of a category (pages or sub‑categories) handling continuation.
 * @param {string} category   Category name without the "Category:" prefix.
 * @param {string} cmtype     Either "page" or "subcat".
 * @returns {Promise<Array>}  Array of categorymember objects.
 */
async function fetchAllCategoryMembers(category, cmtype) {
  let members = [];
  let cmcontinue = undefined;

  do {
    const params = new URLSearchParams({
      origin: "*",
      action: "query",
      list: "categorymembers",
      cmtitle: `Category:${category}`,
      cmtype: cmtype,
      cmlimit: "max",
      format: "json",
    });
    if (cmcontinue) {
      params.set("cmcontinue", cmcontinue);
    }

    const apiUrl = `https://en.wikipedia.org/w/api.php?${params.toString()}`;
    const resp = await throttledFetch(apiUrl);
    if (!resp.ok) {
      throw new Error(`Wikipedia API request failed: ${resp.status}`);
    }
    const data = await resp.json();
    members = members.concat(data.query.categorymembers);
    cmcontinue = data.continue?.cmcontinue;
  } while (cmcontinue);

  return members;
}

/**
 * Picks a random item from the cached list.
 * @returns {{title:string, ns:number}}
 */
function pickRandomFromList(list) {
  const idx = Math.floor(Math.random() * list.length);
  return list[idx];
}

/**
 * Removes a specific item from the cached list (by reference).
 * @param {Object} item
 */
function removeFromList(item) {
  const idx = cachedList.indexOf(item);
  if (idx !== -1) {
    cachedList.splice(idx, 1);
  }
}

/**
 * Recursively adds a subtree (all descendant ids) to the current list.
 * @param {string} rootId
 * @param {Map<string,Array>} subtree
 */
function addSubtreeToList(rootId, subtree) {
  const children = subtree.get(rootId);
  if (!children) return;
  for (const item of children) {
    // If the item is a page or sub‑category, ensure it's in cachedList.
    // The item objects already have `title` and `ns`.
    cachedList.push({ title: item.title, ns: item.ns });
    addSubtreeToList(item.id, subtree);
  }
}

/**
 * Updates the global `categoriesMap` tree for a given category.
 * @param {string} category
 * @param {Array} pages
 * @param {Array} subcats
 */
function updateTree(category, pages, subcats) {
  const categoryToLowerCase = category.toLowerCase();
  // Store both pages and sub‑categories as objects with id, title, ns.
  const combined = [...pages, ...subcats].map((m) => ({
    id: m.title, // using title as a simple identifier
    title: m.title,
    ns: m.ns,
  }));
  currentRoot.set(categoryToLowerCase, combined);
  // NOTE: What about updating categoriesMap here also?
}

/**
  * Experimental
 * @param {string} category
 */
function mergeSubtree(subree) {
  for (const item of subtree.entries()) {
    currentRoot.set(item[0], item[1]);
  }
  const categoryRootNode = categoryInput.value
  categoriesMap.set(categoryRootNode, currentRoot)
}


/**
 * Returns a new Map containing the subtree rooted at `cat` (including all descendants).
 * @param {string} cat
 * @param {Map<string,Array>} parentTree
 * @param {Map<string,Array>} [newMap]
 * @returns {Map<string,Array>}
 */
function pickDescendants(cat, parentTree, newMap) {
  const categoryToLowerCase = cat.toLowerCase();
  const children = parentTree.get(categoryToLowerCase);
  if (!children) return newMap;
  if (!newMap) newMap = new Map();
  newMap.set(categoryToLowerCase, children);
  for (const item of children) {
    pickDescendants(item.title, parentTree, newMap);
  }
  return newMap;
}

/**
 * Checks if a category (or its subtree) is already in memory.
 * @param {string} cat
 * @returns {Map<string,Array>|undefined}
 */
function checkCachesForCategory(cat) {
  const categoryToLowerCase = cat.toLowerCase();
  // is category in in-memory store (categoriesMap)
  // as it's own tree
  const cachedCategory = categoriesMap.get(categoryToLowerCase);
  if (cachedCategory) {
    return cachedCategory;
  }

  // Check if the category is in in-memory store (categoriesMap)
  // As a subtree of any stored tree
  // If yes return it as a separate tree
  for (const tree of categoriesMap.values()) {
    for (const storedKey of tree.keys()) {
      if (storedKey.toLowerCase() === categoryToLowerCase) {
        const newTree = pickDescendants(storedKey, tree);
        if (newTree) return newTree;
      }
    }
  }
}

/**
 * Fetches pages and sub‑categories for a category and updates caches.
 * @param {string} category
 */
async function fetchAndCacheCategory(category) {
  // Fetch pages and sub‑categories concurrently
  const [pages, subcats] = await Promise.all([
    fetchAllCategoryMembers(category, "page"),
    fetchAllCategoryMembers(category, "subcat"),
  ]);

  if (pages.length === 0 && subcats.length === 0) {
    console.log(`Category "${category}" has no members.`);
    return;
  }

  updateTree(category, pages, subcats);

  // Add members to the cached list
  pages.forEach((m) => cachedList.push({ title: m.title, ns: m.ns }));
  subcats.forEach((m) => cachedList.push({ title: m.title, ns: m.ns }));
}

async function openPage(candidate) {
  const url = `https://en.wikipedia.org/wiki/${encodeURIComponent(
    candidate.title
  )}`;
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  await chrome.tabs.update(tabs[0].id, { url });
}
/* -------------------------------------------------------------------------- */
/*  Event listeners                                                          */
/* -------------------------------------------------------------------------- */

setBtn.addEventListener("click", async () => {
  const value = categoryInput.value.trim();
  if (!value) return;
  // NOTE: use the global instead of value?
  currentCategory = value
  // TODO: return in case category was not changed but user clicked
  cachedList = []

  const cachedCategory = checkCachesForCategory(value);
  currentRoot = cachedCategory || new Map();
  // categoriesMap.set(value, currentRoot);
  if (cachedCategory) {
    randomBtn.disabled = false; // enable random button if category exists in cache
    // if we got a subtree from larger tree from the cache, save it to cache
    const lkValue = value.toLowerCase()
    if (!categoriesMap.has(lkValue)) {
      categoriesMap.set(lkValue, currentRoot)
    }
    addSubtreeToList(value, currentRoot);
  } else {
    randomBtn.disabled = true; // disabled until initial fetch finishes

    try {
      await fetchAndCacheCategory(value);
      randomBtn.disabled = false;
      console.log(`Category "${value}" loaded with ${cachedList.length} items.`);
    } catch (e) {
      console.log(`Failed to load category: ${e.message}`);
      randomBtn.disabled = true;
    }
  }
  storeCategory(value);
});

randomBtn.addEventListener("click", async () => {
  // NOTE: Is this the correct check for root category?
  if (!currentRoot) {
    console.log("No root category set.");
    return;
  }

  randomBtn.disabled = true; // disable during processing
  setBtn.disabled = true; // disable during processing
  const MAX_FETCHES = 5;
  let fetchesDone = 0;

  try {
    while (fetchesDone < MAX_FETCHES) {
      if (cachedList.length === 0) {
        throw new Error("Cache is empty – no items to choose from.");
      }

      const candidate = pickRandomFromList(cachedList);

      // Page → open it
      if (candidate.ns === 0) {
        openPage(candidate)

        // Save the updated categoriesMap to storage
        saveCategoriesMapToStorage();
        console.log("Found a page. Finishing.")
        return;
      }

      // Skip portals (ns 100) – not handled yet
      if (candidate.ns === 100) {
        continue;
      }

      // Candidate is a category – expand it
      // If user specified a large category and we previusly fetched
      // its subcategory let's not fetch it but reuse the cache
      const catName = candidate.title.replace(/^Category:/i, "");
      const ctg = checkCachesForCategory(catName);
      if (ctg) {
        addSubtreeToList(catName, ctg);
        console.log('!!!need to merge category tree!!!')
        // mergeSubtree(ctg)
      } else {
        await fetchAndCacheCategory(catName);
        // TODO: log fetches
        fetchesDone++;
      }
      // Remove the processed category from the list
      removeFromList(candidate);
    }

    // Handle case when we've exausted fetch limit and didn't get a page yet
    const pagesList = cachedList.filter(e => e.ns === 0)
    if (pagesList.length) {
      openPage(pickRandomFromList(pagesList))
    } else {
      debugBox.appendChild("No pages fetched this round")
    }

    // Save the updated categoriesMap to storage
    saveCategoriesMapToStorage();
  } catch (err) {
    console.log(`Error: ${err.message}`);
  } finally {
    // Re‑enable after a short cooldown to respect rate limits
    setTimeout(() => {
      randomBtn.disabled = false;
      setBtn.disabled = false;
    }, RATE_LIMIT_MS);
  }
});

document.addEventListener("DOMContentLoaded", () => {
  setTimeout(async () => {
    await loadCategoriesMap();
    loadSelectedCategory();
  }, 10000)
});
