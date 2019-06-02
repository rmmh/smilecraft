import Vue from "vue"
import { decode } from 'base64-arraybuffer'
import * as _ from "lodash"
import "./style.scss"

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
    clone(): Vector {
        const arr = new Float32Array(300)
        arr.set(this.data)
        return Object.assign(Object.create(Vector.prototype), { data: arr })
    }
    imul(x: number) {
        for (let i = 0; i < this.data.length; i++) {
            this.data[i] *= x
        }
    }
    iadd(b: Vector) {
        for (let i = 0; i < this.data.length; i++) {
            this.data[i] += b.data[i]
        }
    }
    // a.imac(b, c) => a = a + b * c
    imac(b: Vector, c: number) {
        for (let i = 0; i < this.data.length; i++) {
            this.data[i] += b.data[i] * c
        }
    }
    dist(b: Vector) {
        let d = 0
        for (let i = 0; i < this.data.length; i++) {
            d += Math.abs(this.data[i] - b.data[i])
        }
        return d
    }
    mag() {
        let s = 0
        for (const c of this.data) s += Math.abs(c)
        return s
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
        const presentAbbrs = new Set<string>();
        for (let i = 0; i < document.styleSheets.length; i++) {
            const ss = document.styleSheets[i]
            if (ss instanceof CSSStyleSheet) {
                for (let j = 0; j < ss.cssRules.length; j++) {
                    const rule = ss.rules[j]
                    if (rule instanceof CSSStyleRule) {
                        if (/^\.em-\S*$/.test(rule.selectorText)) {
                            presentAbbrs.add(rule.selectorText.slice(4))
                        }
                    }
                }
            }
        }
        const reChars = []
        this.classes = {}
        for (const em of ems) {
            if (presentAbbrs.has(em.abbr) || em.name.startsWith('flag_')) {
                reChars.push(em.char.replace(/\*/, '\\*'))
                this.classes[em.char] = "em-" + em.abbr
            }
        }
        this.re = new RegExp('(' + reChars.join('|') + ')', 'g')
    }

    sub(m: string): string {
        const div = document.createElement('div')
        div.classList.add('em', this.classes[m])
        div.innerHTML = m
        return div.outerHTML
    }

    replace(e: HTMLElement) {
        e.innerHTML = e.innerHTML.replace(this.re, m => this.sub(m))
    }
}

async function load() {
    let emoji = await loadEmoji()
    const log = document.getElementById("log")
    let em8 = emoji.filter(x => x.rank >= 0 && x.rank < 259 && !x.name.startsWith('flag_'))
    let abbr_to_em = _.fromPairs(em8.map(e => [e.abbr, e]))
    if (log) {
        let replacer = new EmojiReplacer(emoji)
        log.innerText += em8// emoji.filter(x => x.rank >= 0)
            .map(x => x.char).sort().join("")
        log.innerText += "\n" + JSON.stringify(emoji[0])
        // insertEmoji(log)
        replacer.replace(log)
    }
    em8 = _.sortBy(em8, e => e.rank)

    const E = Vue.component('E', {
        props: ['em'],
        template: `<div :class="'em em-' + em.abbr" :title="em.name">{{em.char}}</div>`,
    })

    function makeCoeffs(input: string): [number, Emoji][] {
        const counts = _.countBy(input.toLowerCase().split(/\s+/))
        const coeffs: [number, Emoji][] = []
        for (const [a, k] of Object.entries(counts)) {
            if (!abbr_to_em[a]) continue
            coeffs.push([-Math.pow(-1, k) * (1 + ((k - 1) >> 1)), abbr_to_em[a]])
        }
        // console.log(coeffs.map(x => `${x[0]} ${x[1].abbr}`))
        return _.sortBy(coeffs, e => [-e[0], e[1].rank])
    }

    function evaluate(coeffs: [number, Emoji][]): Vector {
        const val = coeffs[0][1].vec.clone();
        val.imul(coeffs[0][0])
        for (const [k, e] of coeffs.slice(1)) {
            val.imac(e.vec, k)
        }
        return val
    }

    function nearest(v: Vector, haveSet: Set<string>): Emoji {
        return <Emoji>_.minBy(em8, e => haveSet.has(e.abbr) ? Infinity : v.dist(e.vec))
    }

    Vue.component('eq', {
        props: ['coeffs'],
        render: function (createElement) {
            let children = [];
            for (let [c, e] of this.$props.coeffs) {
                if (c > 0) {
                    if (children.length) {
                        children.push(' + ')
                    }
                } else if (c === -1) {
                    children.push(children.length ? ' - ' : '-')
                }
                if (Math.abs(c) !== 1) {
                    children.push(c)
                }
                children.push(
                    createElement(E,
                        { props: { em: e } }))
            }
            if (this.$props.coeffs.length) {
                const value = evaluate(this.$props.coeffs)
                const result = nearest(value, new Set(this.$props.coeffs.map((e: any) => e[1].abbr)))
                const frac = value.dist(result.vec)
                children.push(' = ', createElement(E, { props: { em: result } }), result.abbr, " " + Math.round(frac * 100) / 100)
            }
            return createElement('span',
                children)
        }
    })

    let vm = new Vue({
        el: "#app",
        template: `<div>
            <eq :coeffs="eq(inp)" class="eq" /><br>
            <input id="repl" v-model="inp" type="text" placeholder="enter recipe" />
            <div class="legend">
                <div v-for="em in ems">
                    {{ em.abbr }}<br><E :em="em"/>
                </div>
            </div>
        </div>`,
        data: {
            inp: "hec cat cat",
            ems: em8,
            eq: makeCoeffs,
        }
    });

    (<any>window).app = vm;
    (<any>window).em8 = em8
}


load()
