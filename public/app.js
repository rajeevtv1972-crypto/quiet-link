const form = document.querySelector("#shorten-form");
const urlInput = document.querySelector("#long-url");
const expirySelect = document.querySelector("#expiry");
const customExpiry = document.querySelector("#custom-expiry");
const customDuration = document.querySelector("#custom-duration");
const customUnit = document.querySelector("#custom-unit");
const previewCheckbox = document.querySelector("#destination-preview");
const submitButton = document.querySelector("#submit-button");
const buttonLabel = submitButton.querySelector(".button-label");
const formMessage = document.querySelector("#form-message");
const resultPanel = document.querySelector("#result-panel");
const shortUrl = document.querySelector("#short-url");
const expirySummary = document.querySelector("#expiry-summary");
const copyButton = document.querySelector("#copy-button");
const shareButton = document.querySelector("#share-button");
const copyMessage = document.querySelector("#copy-message");
const qrContainer = document.querySelector("#qr-code");
const downloadQrButton = document.querySelector("#download-qr-button");
const managementControls = document.querySelector("#management-controls");
const managementTokenInput = document.querySelector("#management-token");
const copyManagementButton = document.querySelector("#copy-management-button");
const showManagementButton = document.querySelector("#show-management-button");
const revokeButton = document.querySelector("#revoke-button");
const revokeMessage = document.querySelector("#revoke-message");
const revokedState = document.querySelector("#revoked-state");

let activeCode = null;
let activeManagementToken = null;

document.querySelector("#year").textContent = new Date().getFullYear();

function setMessage(message) {
  formMessage.textContent = message;
  formMessage.hidden = !message;
}

function selectedExpirySeconds() {
  if (expirySelect.value === "never") return null;
  if (expirySelect.value !== "custom") return Number(expirySelect.value);

  const amount = Number(customDuration.value);
  if (!Number.isInteger(amount) || amount < 1 || amount > 365) {
    throw new Error("Choose a whole number between 1 and 365 for the custom duration.");
  }
  const seconds = amount * (customUnit.value === "days" ? 86400 : 3600);
  if (seconds < 3600 || seconds > 31536000) {
    throw new Error("Custom links must last from 1 hour to 365 days.");
  }
  return seconds;
}

function readableExpiry(expiresAt) {
  if (expiresAt === null) return "No expiry";
  const date = new Date(expiresAt);
  if (Number.isNaN(date.getTime())) return "Expiry selected";
  return "Expires " + date.toLocaleString(undefined, {
    year: "numeric", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit"
  });
}

function setBusy(isBusy) {
  submitButton.disabled = isBusy;
  buttonLabel.textContent = isBusy ? "Creating your link…" : "Create short link";
}

function fallbackCopy(text) {
  const temporary = document.createElement("textarea");
  temporary.value = text;
  temporary.setAttribute("readonly", "");
  temporary.style.position = "fixed";
  temporary.style.left = "-9999px";
  document.body.appendChild(temporary);
  temporary.select();
  const copied = document.execCommand("copy");
  temporary.remove();
  if (!copied) throw new Error("Copy was blocked by your browser. Select the text and copy it manually.");
}

async function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
  } else {
    fallbackCopy(text);
  }
}

function resetManagementState() {
  activeCode = null;
  activeManagementToken = null;
  managementTokenInput.value = "";
  managementTokenInput.type = "password";
  showManagementButton.textContent = "Show key";
  managementControls.hidden = false;
  revokedState.hidden = true;
  revokeMessage.textContent = "";
  revokeButton.disabled = false;
  copyManagementButton.disabled = false;
  revokeButton.hidden = false;
}

function renderQr(shortLink) {
  qrContainer.replaceChildren();
  if (typeof QRCode !== "function") {
    qrContainer.textContent = "QR generation is unavailable in this browser. You can still copy the short link.";
    downloadQrButton.disabled = true;
    return;
  }

  try {
    new QRCode(qrContainer, {
      text: shortLink,
      width: 192,
      height: 192,
      colorDark: "#202840",
      colorLight: "#ffffff",
      correctLevel: QRCode.CorrectLevel.M
    });
    downloadQrButton.disabled = false;
  } catch {
    qrContainer.textContent = "Couldn't make a QR code for this link.";
    downloadQrButton.disabled = true;
  }
}

expirySelect.addEventListener("change", () => {
  customExpiry.hidden = expirySelect.value !== "custom";
  if (expirySelect.value === "custom") customDuration.focus();
  setMessage("");
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  setMessage("");
  resultPanel.hidden = true;
  copyMessage.textContent = "";
  revokeMessage.textContent = "";
  resetManagementState();

  const enteredUrl = urlInput.value.trim();
  if (!enteredUrl) {
    setMessage("Paste a URL to get started.");
    urlInput.focus();
    return;
  }

  let expiresInSeconds;
  try {
    expiresInSeconds = selectedExpirySeconds();
  } catch (error) {
    setMessage(error.message);
    customDuration.focus();
    return;
  }

  try {
    const parsed = new URL(enteredUrl);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error("Only http:// and https:// links are supported.");
    }
    if (parsed.username || parsed.password) {
      throw new Error("Remove any username or password from the URL before shortening it.");
    }
  } catch (error) {
    setMessage(error.message || "Enter a valid URL including https://.");
    urlInput.focus();
    return;
  }

  setBusy(true);
  try {
    const response = await fetch("/api/shorten", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: enteredUrl,
        expiresInSeconds,
        preview: previewCheckbox.checked
      })
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || "We couldn't create that link. Please try again.");
    }

    activeCode = data.code;
    activeManagementToken = data.managementToken || null;
    shortUrl.href = data.shortUrl;
    shortUrl.textContent = data.shortUrl;
    shortUrl.classList.remove("revoked-link");
    expirySummary.textContent = readableExpiry(data.expiresAt);
    managementTokenInput.value = activeManagementToken || "";
    showManagementButton.hidden = !activeManagementToken;
    copyManagementButton.disabled = !activeManagementToken;
    revokeButton.disabled = !activeManagementToken;
    revokeButton.hidden = !activeManagementToken;
    renderQr(data.shortUrl);
    resultPanel.hidden = false;
    copyButton.disabled = false;
    shareButton.disabled = false;
    resultPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
  } catch (error) {
    setMessage(error.message || "Something went wrong. Please try again.");
  } finally {
    setBusy(false);
  }
});

copyButton.addEventListener("click", async () => {
  const value = shortUrl.href;
  try {
    await copyText(value);
    copyMessage.textContent = "Short link copied.";
  } catch (error) {
    copyMessage.textContent = error.message || "Copy failed. Please copy the link manually.";
  }
});

copyManagementButton.addEventListener("click", async () => {
  if (!activeManagementToken) return;
  try {
    await copyText(activeManagementToken);
    revokeMessage.textContent = "Management key copied. Save it somewhere safe.";
  } catch (error) {
    revokeMessage.textContent = error.message || "Copy failed. You can reveal and copy the key manually.";
  }
});

showManagementButton.addEventListener("click", () => {
  const willReveal = managementTokenInput.type === "password";
  managementTokenInput.type = willReveal ? "text" : "password";
  showManagementButton.textContent = willReveal ? "Hide key" : "Show key";
});

downloadQrButton.addEventListener("click", () => {
  const canvas = qrContainer.querySelector("canvas");
  const image = qrContainer.querySelector("img");
  const imageUrl = canvas ? canvas.toDataURL("image/png") : image?.src;
  if (!imageUrl || !imageUrl.startsWith("data:image/")) {
    copyMessage.textContent = "The QR image isn't ready yet. Please try again.";
    return;
  }

  const download = document.createElement("a");
  download.href = imageUrl;
  download.download = "quietlink-qr.png";
  document.body.appendChild(download);
  download.click();
  download.remove();
  copyMessage.textContent = "QR code downloaded as PNG.";
});

revokeButton.addEventListener("click", async () => {
  if (!activeCode || !activeManagementToken) {
    revokeMessage.textContent = "The management key is unavailable. This link cannot be revoked from this screen.";
    return;
  }
  if (!window.confirm("Revoke this short link? Anyone using it will no longer be redirected after the change propagates.")) {
    return;
  }

  revokeButton.disabled = true;
  revokeMessage.textContent = "Revoking link…";
  try {
    const response = await fetch("/api/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: activeCode, managementToken: activeManagementToken })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || "We couldn't revoke this link. Please try again.");
    }

    shortUrl.removeAttribute("href");
    shortUrl.textContent = "Revoked: " + shortUrl.textContent;
    shortUrl.classList.add("revoked-link");
    copyButton.disabled = true;
    shareButton.disabled = true;
    downloadQrButton.disabled = true;
    qrContainer.replaceChildren();
    managementControls.hidden = true;
    revokedState.hidden = false;
    revokeMessage.textContent = data.message || "Link revoked.";
    activeCode = null;
    activeManagementToken = null;
    managementTokenInput.value = "";
  } catch (error) {
    revokeMessage.textContent = error.message || "Revocation failed. Please try again.";
    revokeButton.disabled = false;
  }
});

shareButton.addEventListener("click", async () => {
  const value = shortUrl.href;
  if (navigator.share) {
    try {
      await navigator.share({ title: "A short link", url: value });
      copyMessage.textContent = "Share sheet opened.";
      return;
    } catch (error) {
      if (error && error.name === "AbortError") return;
    }
  }
  try {
    await copyText(value);
    copyMessage.textContent = "Link copied. Paste it into your message.";
  } catch (error) {
    copyMessage.textContent = error.message || "Sharing isn't available in this browser.";
  }
});