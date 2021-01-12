const fs       = require("fs")
const path     = require("path")
const { exec } = require("child_process")
const express  = require("express")
const app      = express()
const port     = process.env.PORT || 3070

app.use(express.json()) // for parsing application/json

function escapeString(value) {
    if (value === "" || value == null) {
	return `""`
    }
    return `"${value}"`
}

function writeFile(file) {
    const { filepath, content } = file
    fs.writeFileSync(filepath, content)
}

function flatten(coll) {
    return [].concat(...coll)
}

function flatMap(coll, f) {
    return flatten(coll.map(f))
}

function pair(key, value) {
    if (key == null) {
	return []
    }
    return [key, escapeString(value)]
}

function filePath(requestIdentifier, fileName) {
    return fileName
	? path.resolve("out", requestIdentifier, fileName)
	: path.resolve("out", requestIdentifier)
}

function urlPath(requestIdentifier, fileName) {
    return "file://" + path.resolve("out", requestIdentifier, fileName)
}

const globalOptionsMapping = {
    "MarginBottom": (value) => typeof value === "number" ? ["--margin-bottom", 10 * value] : [],
    "MarginLeft":   (value) => typeof value === "number" ? ["--margin-left",   10 * value] : [],
    "MarginRight":  (value) => typeof value === "number" ? ["--margin-right",  10 * value] : [],
    "MarginTop":    (value) => typeof value === "number" ? ["--margin-top",    10 * value] : [],
    "Orientation":  (value) => ["--orientation", value === "Landscape" ? "Landscape" : "Portrait"],
    "PageHeight":   "--page-height",
    "PageSize":     "--page-size",
    "PageWidth":    "--page-width",
    "Title":        "--title"
}

const pageOptionsMapping = {
    "CustomHeader": (headers) => flatMap((headers || []), ({ Key, Value }) => [
	"--custom-header", escapeString(Key), escapeString(Value)
    ]),
    "CustomHeaderPropagation": (_) => ["--custom-header-propagation"],
    "Encoding":      "--encoding",
    "HeaderSpacing": "--header-spacing"
}

function buildPageOptions(pageOptions) {
    return flatMap(Object.entries(pageOptions || {}), ([key, value]) => {
	const mapping = pageOptionsMapping[key]
	if (typeof mapping === "string") {
	    return pair(mapping, value)
	}
	if (typeof mapping === "function") {
	    return mapping(value)
	}
	return []
    })
}

function handler(req, res) {
    const payload = req.body
    const { RequestIdentifier, GlobalOptions, Cover, TOC, Pages } = payload
    const guidRegex = /[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}/gi
    
    if (!(typeof RequestIdentifier === "string" && guidRegex.test(RequestIdentifier))) {
	console.error(`[ERROR] Invalid request identifier '${RequestIdentifier}'`)
	return res.sendStatus(500)
    }

    console.log(`Recceived new request '${RequestIdentifier}'`)

    const globalOptionsPart = flatMap(Object.entries(GlobalOptions || {}), ([key, value]) => {
	const mapping = globalOptionsMapping[key]
	if (typeof mapping === "string") {
	    return pair(mapping, value)
	}
	if (typeof mapping === "function") {
	    return mapping(value)
	}
	return []
    })

    const coverPageOptions = Cover.PageOptions || {}
    const coverPart = Cover ? flatten([
	["cover", urlPath(RequestIdentifier, "cover.html")],
	coverPageOptions.HeaderHTML
	    ? ["--header-html", urlPath(RequestIdentifier, `cover_header.html`)]
	    : [],
	coverPageOptions.FooterHTML
	    ? ["--footer-html", urlPath(RequestIdentifier, `cover_footer.html`)]
	    : [],
	buildPageOptions(coverPageOptions)
    ]) : []

    const tocPart = TOC ? flatten([
	[
	    "toc",
	    "--disable-toc-links", "false",
	    "--disable-javascript", "false"
	],
	TOC.XslStyleSheet
	    ? ["--xsl-style-sheet", urlPath(RequestIdentifier, "toc.xsl")]
	    : []
    ]) : []

    const pagesPart = flatMap((Pages || []).map(page => page.PageOptions || {}), (pageOptions, pageIndex) => flatten([
	["page", urlPath(RequestIdentifier, `page_${pageIndex}.html`)],
	pageOptions.HeaderHTML
	    ? ["--header-html", urlPath(RequestIdentifier, `page_${pageIndex}_header.html`)]
	    : [],
	pageOptions.FooterHTML
	    ? ["--footer-html", urlPath(RequestIdentifier, `page_${pageIndex}_footer.html`)]
	    : [],
	buildPageOptions(pageOptions)
    ]))
    
    const command = flatten([
	["wkhtmltopdf"],
	globalOptionsPart,
	coverPart,
	tocPart,
	pagesPart,
	[filePath(RequestIdentifier, "output.pdf")]
    ]).join(" ")

    process.stdout.write("Creating temp files...")
    
    fs.mkdirSync(filePath(RequestIdentifier))

    if (Cover) {
	writeFile({
	    filepath: filePath(RequestIdentifier, "cover.html"),
	    content: (Cover.PageHTML || "")
	})
    }

    if (TOC && TOC.XslStyleSheet) {
	writeFile({
	    filepath: filePath(RequestIdentifier, "toc.xsl"),
	    content: TOC.XslStyleSheet
	})
    }

    for (let [pageIndex, { PageHTML, PageOptions }] of (Pages || []).entries()) {
	writeFile({
	    filepath: filePath(RequestIdentifier, `page_${pageIndex}.html`),
	    content: (PageHTML || "")
	})
	if (PageOptions && PageOptions.HeaderHTML) {
	    writeFile({
		filepath: filePath(RequestIdentifier, `page_${pageIndex}_header.html`),
		content: PageOptions.HeaderHTML
	    })
	}
	if (PageOptions && PageOptions.FooterHTML) {
	    writeFile({
		filepath: filePath(RequestIdentifier, `page_${pageIndex}_footer.html`),
		content: PageOptions.FooterHTML
	    })
	}
    }

    console.log("Done")

    console.log("Creating PDF...")
    
    exec(command, (error, stdout, stderr) => {
	if (error) {
	    console.error(`[ERROR] ${error.message}`)
	    res.sendStatus(500)
	    return
	}
	if (stderr) {
	    console.log(stderr)
	}
	process.stdout.write("Removing temp files...")
	res.sendFile(filePath(RequestIdentifier, "output.pdf"), (err) => {
	    if (err) {
		console.error(`[ERROR] Failed to send ${RequestIdentifier}/output.pdf (${err})`)
	    }
	    fs.rm(filePath(RequestIdentifier), {
		recursive: true,
		force: true
	    }, (err) => {
		if (err) {
		    console.error(`[ERROR] Failed to remove folder '${RequestIdentifier}' (${err})`)
		    return
		}
		console.log("Done")
	    })
	})
    })
}

app.post('/generate', handler)

app.listen(port, () => {
    console.log(`PDF Service listening at Port ${port}`)
})
