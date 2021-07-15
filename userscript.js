// ==UserScript==
// @name Pixiv Media Downloader
// @version 0.1
// @icon https://pixiv.net/favicon.ico
// @include https://www.pixiv.net/*
// @run-at document-idle
// @noframes
// @require https://cdnjs.cloudflare.com/ajax/libs/jszip/3.6.0/jszip.min.js
// @require https://greasyfork.org/scripts/2963-gif-js/code/gifjs.js
// @grant GM_xmlhttpRequest
// ==/UserScript==

const ARTWORK_URL = /https:\/\/www\.pixiv\.net\/([a-z]+\/)?artworks\/[0-9]+/

async function waitFor(f_condition) {
  return new Promise(resolve => {
    new MutationObserver((mutation, me) => {
      if (out = f_condition(mutation)) {
        resolve(out)
        me.disconnect()
        return
      }
    }).observe(document, {
      childList: true,
      subtree: true
    })
  })
}

function createButton(text, onclick) {
  const node = document.createElement("div")
  node.style.marginRight = "10px"

  const button = document.createElement("button")
  button.type = "button"
  button.onclick = onclick
  button.style.display = "inline-block"
  button.style.height = "32px"
  button.style.lineHeight = "32px"
  button.style.border = "none"
  button.style.background = "none"
  button.style.color = "inherit"
  button.style.fontWeight = "700"
  button.style.cursor = "pointer"

  const span = document.createElement("span")
  span.style.verticalAlign = "middle"

  span.appendChild(document.createTextNode(text))
  button.appendChild(span)
  node.appendChild(button)

  return node
}

function saveFile(filename, data) {
  let link = document.createElement("a")
  link.href = URL.createObjectURL(data)
  link.download = filename
  link.click()
  URL.revokeObjectURL(link.href)
  link.remove()
}

function requestImage(url, callback) {
  GM_xmlhttpRequest({
    method: "GET",
    url: url,
    responseType: "blob",
    headers: { "Referer": "https://www.pixiv.net/" },
    onload: callback
  })
}

function loadImage(src, callback) {
  return new Promise(resolve => {
    const img = new Image()
    img.onload = _ => callback(img, resolve)
    img.src = src
  })
}

function fetchImages(url_base, filename_base, illustration_count) {
  let url = url_base
  const is_multi_image = illustration_count > 1
  const images = []

  for (let i = 0; i < illustration_count; i++) {
    if (is_multi_image) {
      url = url.replace(/_p\d+/, `_p${i}`)
    }

    requestImage(url, req => {
      console.log(`[${req.statusText}:${req.status}] ${req.finalUrl}`)
      if (req.status == 200) {
        const extension = url.split(".").pop()
        const filename = filename_base + (is_multi_image ? `.p${i}` : '') + "." + extension
        images.push({ filename: filename, data: req.response })
      }
    })

  }
  return images
}

(async function scriptInit() {
  history.pushState = (function (_super) {
    return function () {
      const funcResult = _super.apply(this, arguments)
      scriptInit()
      return funcResult
    }
  })(history.pushState)

  if (!window.location.href.match(ARTWORK_URL))
    return;

  const gif_script = document.createElement("script")
  gif_script.src = "https://cdnjs.cloudflare.com/ajax/libs/gif.js/0.2.0/gif.js"
  document.head.appendChild(gif_script)

  const image_id = document.URL.split("/").pop()

  const illust_data_response = await fetch("https://www.pixiv.net/ajax/illust/" + image_id)
  const illust_data = (await illust_data_response.json()).body
  console.log(illust_data)

  const filename = illust_data.illustTitle + "-" + image_id + "-" + illust_data.userAccount + "-" + illust_data.createDate.replace(":", "_")

  const button_section = await waitFor(mutation => {
    let sections = document.querySelectorAll("section")
    if (sections.length >= 2 && sections[1].childElementCount >= 3 /* NOTE: 3 for guests, 4 for logged users */) {
      return sections[1]
    }
  })

  if (illust_data.illustType == 0 || illust_data.illustType == 1) /* Picture & Manga */ {
    const url = illust_data.urls.original
    const images = fetchImages(url, filename, illust_data.pageCount)

    if (illust_data.pageCount == 1) /* Single image mode */ {
      button_section.appendChild(createButton("Save Original", function () {
        saveFile(images[0].filename, images[0].data)
      }))
      return;
    }

    button_section.appendChild(createButton("Download each image separately", function () {
      images.forEach(image => { saveFile(image.filename, image.data) })
    }))

    button_section.appendChild(createButton("Download as zip", function () {
      const zip = new JSZip()
      images.forEach(image => zip.file(image.filename, image.data, { binary: true }))
      zip.generateAsync({ type: "blob" }).then(content => saveFile(filename + ".zip", content))
    }))

    button_section.appendChild(createButton("Save as cntinuous image", async function () {
      const canvas = document.createElement("canvas")
      const context = canvas.getContext("2d")
      const fetched_images = []

      canvas.width = 0
      canvas.height = 0

      await Promise.all(
        images.map((image, idx) => {
          const url = URL.createObjectURL(image.data)

          return loadImage(url, (img, resolve) => {
            if (canvas.width < img.width) {
              canvas.width = img.width
            }
            canvas.height += img.height
            fetched_images.push(img)

            URL.revokeObjectURL(url)
            resolve(this)
          })
        })
      )

      let current_position = 0;
      fetched_images.forEach(image => {
        context.drawImage(image, Math.round((canvas.width - image.width) / 2), current_position)
        current_position += image.height
      })

      const extension = url.split(".").pop()
      canvas.toBlob(blob => saveFile(filename + "." + extension, blob), images[0].data.type)
    }))
  }
  else if (illust_data.illustType == 2) /* Ugoira */{
    const ugoira_meta_response = await fetch("https://www.pixiv.net/ajax/illust/" + image_id + "/ugoira_meta")
    const ugoira_meta_data = (await ugoira_meta_response.json()).body

    button_section.appendChild(createButton("Save as GIF", async function () {
      const zip_file_response = await fetch(ugoira_meta_data.originalSrc)
      const zip_blob = await zip_file_response.blob()

      new JSZip().loadAsync(zip_blob)
      .then(async zip => {
        const gif = new GIF({ workers: 4, quality: 10, workerScript: GIF_worker_URL })
        gif.on("finished", blob => {
          saveFile(filename + ".gif", blob)
        })

        await Promise.all(
          ugoira_meta_data.frames.map(async frame => {
            const data = await zip.file(frame.file).async("blob")
            const url = URL.createObjectURL(data)
            return loadImage(url, (img, resolve) => {
              gif.addFrame(img, { delay: frame.delay })
              URL.revokeObjectURL(url)
              resolve(this)
            })
          })
        )

        gif.render()
      })
    }))
  }
})()

