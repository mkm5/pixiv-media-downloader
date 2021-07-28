// ==UserScript==
// @name Pixiv Media Downloader
// @description Simple media downloader for pixiv.net
// @version 0.3.5
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

const MAX_CANVAS_SIZE = 32757
const ARTWORK_URL = /https:\/\/www\.pixiv\.net\/([a-z]+\/)?artworks\/[0-9]+/

async function waitFor(f_condition) {
  return new Promise(resolve => {
    new MutationObserver((mutation, me) => {
      let result = f_condition(mutation)
      if (result) {
        resolve(result)
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
  const button = document.createElement("button")
  button.type = "button"
  button.innerText = text
  button.onclick = onclick
  button.style.marginRight = "10px"
  button.style.display = "inline-block"
  button.style.height = "32px"
  button.style.lineHeight = "32px"
  button.style.border = "none"
  button.style.background = "none"
  button.style.color = "inherit"
  button.style.fontWeight = "700"
  button.style.cursor = "pointer"
  button._setup = function () { this._ot = this.innerText; this.disabled = true; return this }
  button._reset = function () { this.innerText = this._ot; this.disabled = false }
  button._update = function (text) { this.innerText = this._ot + text }
  return button
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

async function fetchImages(url_f, n, _call_on_fetch) {
  return Promise.all(
    [...Array(n).keys()].map(idx => {
      return new Promise(resolve => {
        const url = url_f(idx)
        requestImage(url)
        .then(data => {
          const resolved = _call_on_fetch(idx, data, resolve)
          if (!resolved) {
            resolve([idx, data])
          }
        })
      })
    })
  )
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
        const btn = this._setup()
        requestImage(url).then(data => {
          saveFile(filename + '.' + extension, data)
          btn._reset()
        })
      }))
      return;
    }

    const next_url = n => url.replace(/p\d+/, `p${n}`)

    button_section.appendChild(createButton("Download separately", async function () {
      const btn = this._setup()
      let i = 0
      await fetchImages(next_url, illust_data.pageCount, (idx, data) => {
        const percents = Math.round((++i / illust_data.pageCount) * 100)
        btn._update(` [${percents}%]`)
        saveFile(filename + `.p${idx}` + "." + extension, data)
      })
      btn._reset()
    }))

    button_section.appendChild(createButton("Download zip", async function () {
      const btn = this._setup()
      const zip = new JSZip()

      let i = 0
      await fetchImages(next_url, illust_data.pageCount, (idx, data) => {
        const percents = Math.round((++i / illust_data.pageCount) * 100)
        btn._update(` [${percents}%]`)
        zip.file(filename + `.p${idx}` + "." + extension, data, { binary: true })
      })

      zip.generateAsync({ type: "blob" }).then(content => {
        saveFile(filename + ".zip", content)
        btn._reset()
      })
    }))

    button_section.appendChild(createButton("Download continuous", async function () {
      const btn = this._setup()
      const canvas = document.createElement("canvas")
      canvas.width = 0
      canvas.height = 0
      const context = canvas.getContext("2d")

      let i = 0
      const images = await fetchImages(next_url, illust_data.pageCount, (_, data, resolve) => {
        const object_url = URL.createObjectURL(data)
        loadImage(object_url).then(image => {
          if (canvas.width < image.width)
            canvas.width = image.width
          canvas.height += image.height
          resolve(image)
          URL.revokeObjectURL(object_url)
        })
        const percents = Math.round((++i / illust_data.pageCount) * 70)
        btn._update(` [${percents}%]`)
        return true
      })

      // TODO: Break image loading process when error occures
      if (canvas.height > MAX_CANVAS_SIZE || canvas.width > MAX_CANVAS_SIZE) {
        btn._rest()
        alert("[Error] Image height would exceed the limit. Aborting.")
        return;
      }

      let k = 0
      let current_position = 0
      for (const image of images) {
        const percents = Math.round(70 + (++k / illust_data.pageCount) * 30)
        btn._update(` [${percents}%]`)
        context.drawImage(image, Math.round((canvas.width - image.width) / 2), current_position)
        current_position += image.height
      }

      canvas.toBlob(blob => {
        saveFile(filename + "." + extension, blob)
        btn._reset()
      })
    }))
  }
  else if (illust_data.illustType == 2) /* Ugoira */ {
    const ugoira_meta_response = await fetch("https://www.pixiv.net/ajax/illust/" + image_id + "/ugoira_meta")
    const ugoira_meta_data = (await ugoira_meta_response.json()).body

    button_section.appendChild(createButton("Download GIF", async function () {
      const btn = this._setup()

      btn._update(` [0%]`)
      const zip_file_response = await fetch(ugoira_meta_data.originalSrc)
      btn._update(` [10%]`)
      const zip_blob = await zip_file_response.blob()
      btn._update(` [15%]`)
      const zip = await new JSZip().loadAsync(zip_blob)
      btn._update(` [20%]`)

      const gif = new GIF({ workers: 6, quality: 10, workerScript: GIF_worker_URL })
      gif.on("finished", blob => {
        saveFile(filename + ".gif", blob)
      })

      gif.on("progress", p => {
        btn._update(` [${Math.round(25 + p * 75)}%]`)
      })

      const frames = await Promise.all(
        ugoira_meta_data.frames.map((frame, idx) => {
          return new Promise(resolve => {
            zip.file(frame.file).async("blob")
              .then(data => {
                const url = URL.createObjectURL(data)
                loadImage(url)
                  .then(image => {
                    resolve({ idx: idx, image: image, delay: frame.delay })
                    URL.revokeObjectURL(url)
                  })
              })
          })
        })
      )

      for (const frame of frames) {
        gif.addFrame(frame.image, { delay: frame.delay })
      }
      btn._update(` [25%]`)

      gif.render()
    }))
  }
})()

