const categoryInput = document.getElementById("categoryInput");
const setBtn = document.getElementById("setCategoryBtn");
const randomBtn = document.getElementById("randomBtn");

function loadSelectedCategory() {
  chrome.storage.local.get(["wikiRandomCategory"], (result) => {
    if (result.wikiRandomCategory) {
      categoryInput.value = result.wikiRandomCategory.title;
    }
  });
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.TYPE === "disable-buttons") {
    randomBtn.disabled = true;
    setBtn.disabled = true;
  } else if (message.TYPE === "enable-buttons") {
    randomBtn.disabled = false;
    setBtn.disabled = false;
  } else if (message.TYPE === "disable-random-page-button") {
    randomBtn.disabled = false;
  } else if (message.TYPE === "is-fetching") {
    // initial popup show check to enable buttons
    if (message.value === false) {
      randomBtn.disabled = false;
      setBtn.disabled = false;
    }
  }
});

setBtn.addEventListener("click", async () => {
  const value = categoryInput.value.trim();
  chrome.runtime.sendMessage(null, { TYPE: 'set-category', value })
})

randomBtn.addEventListener("click", () => {
  chrome.runtime.sendMessage(null, { TYPE: "random-article" });
});

document.addEventListener("DOMContentLoaded", () => {
  loadSelectedCategory()
  setTimeout(() => {
    chrome.runtime.sendMessage(null, { TYPE: "check-is-fetching" });
  }, 1000)
})
