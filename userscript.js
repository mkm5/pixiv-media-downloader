// ==UserScript==
// @name Pixiv Media Downloader
// @description Simple media downloader for pixiv.net
// @version 0.2.3
// @icon https://pixiv.net/favicon.ico
// @downloadURL https://raw.githubusercontent.com/mkm5/pixiv-media-downloader/master/userscript.js
// @homepageURL https://github.com/mkm5/pixiv-media-downloader
// @namespace https://github.com/mkm5
// @match https://www.pixiv.net/*
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

async function requestImage(url) {
  return new Promise(resolve => {
    GM_xmlhttpRequest({
      method: "GET",
      url: url,
      responseType: "blob",
      headers: { "Referer": "https://www.pixiv.net/" },
      onload: (req) => {
        console.log(`[${req.statusText}:${req.status}] ${req.finalUrl}`)
        if (req.status == 200) {
          resolve(req.response)
        }
      }
    })
  })
}

async function loadImage(src) {
  return new Promise(resolve => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.src = src
  })
}

async function fetchImages(url_base, illustration_count) {
  const images = {}
  return new Promise(fetch_resolve => {
    const promises = []
    for (let i = 0; i < illustration_count; i++) {
      const url = url_base.replace(/_p\d+/, `_p${i}`)
      promises.push(requestImage(url).then(data => { images[i] = data }))
    }

    Promise.allSettled(promises).then(() => {
      fetch_resolve(images)
    })
  })
}

history.pushState = (function (_super) {
  return function () {
    const funcResult = _super.apply(this, arguments)
    if (window.location.href.match(ARTWORK_URL))
      scriptInit()
    return funcResult
  }
})(history.pushState);

(async function scriptInit() {
  if (!window.location.href.match(ARTWORK_URL))
    return;

  if (typeof GIF === "undefined") {
    const gif_script = document.createElement("script")
    gif_script.src = "https://cdnjs.cloudflare.com/ajax/libs/gif.js/0.2.0/gif.js"
    document.head.appendChild(gif_script)
  }

  const image_id = document.URL.split("/").pop()

  const illust_data_response = await fetch("https://www.pixiv.net/ajax/illust/" + image_id)
  const illust_data = (await illust_data_response.json()).body
  console.log("Fetched data:", illust_data)

  const filename = `${illust_data.illustTitle},${illust_data.illustId}-[${illust_data.userName}]-(${illust_data.createDate.split("T")[0]})`

  const button_section = await waitFor(() => {
    let sections = document.querySelectorAll("section")
    if (sections.length >= 2 && sections[1].childElementCount >= 3 /* NOTE: 3 for guests, 4 for logged users */ ) {
      return sections[1]
    }
  })

  if (illust_data.illustType == 0 || illust_data.illustType == 1) /* Picture & Manga */ {
    const url = illust_data.urls.original
    const extension = url.split(".").pop()

    if (illust_data.pageCount == 1) /* Single image mode */ {
      button_section.appendChild(createButton("Download original", async function () {
        requestImage(url).then(data => saveFile(filename + '.' + extension, data))
      }))
      return;
    }

    button_section.appendChild(createButton("Download separately", async function () {
      const images = await fetchImages(url, illust_data.pageCount)
      Object.entries(images).forEach(([idx, data]) => {
        saveFile(filename + `.p${idx}` + "." + extension, data)
      })
    }))

    button_section.appendChild(createButton("Download zip", async function () {
      const images = await fetchImages(url, illust_data.pageCount)
      const zip = new JSZip()
      for (const [idx, data] of Object.entries(images)) {
        zip.file(filename + `.p${idx}` + "." + extension, data, { binary: true })
      }
      zip.generateAsync({ type: "blob" }).then(content => saveFile(filename + ".zip", content))
    }))

    button_section.appendChild(createButton("Download continuous", async function () {
      const images = await fetchImages(url, illust_data.pageCount)

      const canvas = document.createElement("canvas")
      const context = canvas.getContext("2d")

      canvas.width = 0
      canvas.height = 0

      const fetched_images = await Promise.all(
        Object.values(images).map(data => {
          const object_url = URL.createObjectURL(data)

          return new Promise(resolve => {
            loadImage(object_url).then(image => {
              if (canvas.width < image.width)
                canvas.width = image.width
              canvas.height += image.height

              resolve(image)
              URL.revokeObjectURL(object_url)
            })
          })
        })
      )

      let current_position = 0;
      for (const image of fetched_images) {
        context.drawImage(image, Math.round((canvas.width - image.width) / 2), current_position)
        current_position += image.height
      }

      canvas.toBlob(blob => {
        saveFile(filename + "." + extension, blob)
      })
    }))
  }
  else if (illust_data.illustType == 2) /* Ugoira */ {
    const ugoira_meta_response = await fetch("https://www.pixiv.net/ajax/illust/" + image_id + "/ugoira_meta")
    const ugoira_meta_data = (await ugoira_meta_response.json()).body

    button_section.appendChild(createButton("Download GIF", async function () {
      const btn = this
      btn.disabled = true
      const __original_text = btn.innerText

      btn.innerText = __original_text + ` [0%]`
      const zip_file_response = await fetch(ugoira_meta_data.originalSrc)
      btn.innerText = __original_text + ` [25%]`
      const zip_blob = await zip_file_response.blob()
      btn.innerText = __original_text + ` [50%]`

      new JSZip().loadAsync(zip_blob)
        .then(async zip => {
          const gif = new GIF({ workers: 6, quality: 10, workerScript: GIF_worker_URL })
          gif.on("finished", blob => {
            saveFile(filename + ".gif", blob)
            btn.innerText = __original_text
            btn.disabled = false
          })

          gif.on("progress", x => {
            btn.innerText = __original_text + ` [${Math.round(50 + x * 50)}%]` // Math.round?
          })

          await Promise.allSettled(
            ugoira_meta_data.frames.map(async frame => {
              const data = await zip.file(frame.file).async("blob")
              const url = URL.createObjectURL(data)
              const image = await loadImage(url)
              gif.addFrame(image, { delay: frame.delay })
              URL.revokeObjectURL(url)
            })
          )
          gif.render()
        })
    }))
  }
})()

