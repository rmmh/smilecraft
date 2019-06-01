import { decode } from 'base64-arraybuffer'

type Emoji = {
    name: string,
    rank: number,
    vec: Vector,
    abbr: string,
    char: string,
}
type EmojiSpec = Emoji & { vec: any }

type EmojiSVGSpec = {
    [charCode: string]: string
}

class Vector {
    data: Float32Array
    constructor(encoded: string) {
        if (encoded.length != 300 * 4)
            throw new Error('corrupt vector data: ' + encoded)
        // Vectors are encoded as 1200 base64 characters. Each group of 4
        // is simply a (big-endian) 32 bit float, truncated to 24 bits and
        // encoded to 4 base64 characters. The last byte is assumed to be
        // 0x7f, which is the most correct approximation.
        this.data = new Float32Array(300)
        const buf = new ArrayBuffer(4)
        const viewInt = new Uint8Array(buf)
        const view = new DataView(buf)
        viewInt[3] = 0x7f
        for (let i = 0; i < 300; i++) {
            const buf3 = decode(encoded.slice(i * 4, (i + 1) * 4))
            viewInt.set(new Uint8Array(buf3))
            this.data[i] = view.getFloat32(0, false)
        }
    }
}

function loadJson<T>(url: string): Promise<T> {
    return fetch(url)
        .then(response => {
            if (!response.ok) {
                throw new Error(response.statusText)
            }
            return response.json()
        })
}

async function loadEmoji(): Promise<Emoji[]> {
    const emoji = await loadJson<EmojiSpec[]>('emoji.json')
    for (const em of emoji) {
        em.vec = new Vector(em.vec)
    }
    return emoji
}

class EmojiReplacer {
    re: RegExp
    classes: { [char: string]: string }
    constructor(ems: Emoji[]) {
        const rec = [];
        // this.re = new RegExp('(' + ems.map(e => e.char.replace(/\*/, '\\*')).join('|') + ')', 'g')
        this.classes = {}
        for (const em of ems) {
            if (em.rank >= 0 && em.rank < 256) { // we only the first page
                rec.push(em.char.replace(/\*/, '\\*'))
                this.classes[em.char] = "em-" + em.abbr
            }
        }
        this.re = new RegExp('(' + rec.join('|') + ')', 'g')
    }

    sub(m: string): string {
        /*
        var img = new Image()
        img.setAttribute('draggable', 'false')
        img.className = "emojified " + this.classes[m]
        img.alt = m
        return img.outerHTML
        */
        const div = document.createElement('div')
        div.className = 'emojified ' + this.classes[m]
        div.innerHTML = m
        return div.outerHTML
    }

    replace(e: HTMLElement) {
        e.innerHTML = e.innerHTML.replace(this.re, m => this.sub(m))
    }
}

async function load() {
    let emoji = await loadEmoji()
    let replacer = new EmojiReplacer(emoji)
    const log = document.getElementById("log")
    log.innerText += emoji.filter(x => x.rank >= 0 && x.rank < 256).map(x => x.char).join("")
    log.innerText += "\n" + JSON.stringify(emoji[0])
    // insertEmoji(log)
    replacer.replace(log)
}


load()
