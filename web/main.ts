import Vue from "vue"
import { decode } from 'base64-arraybuffer'
import * as _ from "lodash"
import "./style.scss"
import { Component, Prop } from 'vue-property-decorator'
import { createDecorator } from "vue-class-component"

// @ts-ignore
import VTooltip from 'v-tooltip'

Vue.use(VTooltip)

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
    distManhattan(b: Vector) {
        let d = 0
        for (let i = 0; i < this.data.length; i++) {
            d += Math.abs(this.data[i] - b.data[i])
        }
        return d
    }
    distEuclideanSq(b: Vector) {
        let d = 0
        for (let i = 0; i < this.data.length; i++) {
            const delta = Math.abs(this.data[i] - b.data[i])
            d += delta * delta
        }
        return d
    }
    distCmp(b: Vector) {
        return this.distEuclideanSq(b)
    }
    dist(b: Vector) {
        return Math.sqrt(this.distCmp(b))
    }
    mag() {
        let s = 0
        for (const c of this.data) s += Math.abs(c * c)
        return Math.sqrt(s)
    }
}

class VectorVis {
    mins: Float32Array
    maxs: Float32Array
    avgs: Float32Array
    constructor(vs: Vector[]) {
        this.mins = new Float32Array(vs[0].data.length)
        this.maxs = new Float32Array(this.mins.length)
        this.avgs = new Float32Array(this.mins.length)

        for (const v of vs) {
            for (let i = 0; i < this.mins.length; i++) {
                this.mins[i] = Math.min(this.mins[i], v.data[i])
                this.maxs[i] = Math.max(this.maxs[i], v.data[i])
                this.avgs[i] += v.data[i]
            }
        }
        for (let i = 0; i < this.mins.length; i++) {
            this.avgs[i] /= vs.length
        }
    }
    renderCanvas(ctx: CanvasRenderingContext2D, v: Vector, h: number) {
        for (let i = 0; i < v.data.length; i++) {
            let p = v.data[i]
            p /= 2 * Math.max(-this.mins[i], this.maxs[i])  // normalize
            p = Math.max(-1, Math.min(p, 1))
            let pl = Math.log(Math.abs(p))
            ctx.fillStyle = `hsl(${p < 0 ? 0 : 210}, 100%, ${80 * Math.abs(p)}%)`
            ctx.fillRect(Math.floor(i / h) * 4, Math.floor(i % h) * 4, 4, 4)
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

    // attempt to normalize the feature vectors for prettier display
    let stats = new VectorVis(em8.map(e => e.vec))
    for (const em of em8) {
        const d = em.vec.data
        for (let i = 0; i < d.length; i++) {
            if (stats.avgs[i] < 0) d[i] *= -1
        }
    }
    let ranks = _.sortBy(_.range(0, stats.avgs.length), k => Math.abs(stats.avgs[k]))
    for (const em of em8) {
        const d = em.vec.data
        const nd = new Float32Array(d.length)
        for (let i = 0; i < nd.length; i++) nd[i] = d[ranks[i]]
        em.vec.data = nd
    }

    /*
    import { Component, Prop } from 'vue-property-decorator'
    @Component({
        template: `<div :class="'em em-' + em.abbr" :title="em.name">{{em.char}}</div>`
    })
    class E extends Vue {
        @Prop()
        em!: Emoji
    }
    */
    const E = Vue.component('E', {
        props: ['em'],
        template: `<div :class="'em em-' + em.abbr" :title="em.name">{{em.char}}</div>`,
    })

    class equation {
        coeffs: [number, Emoji][]
        scale: number
        haveSet: Set<string>
        val: Vector | undefined

        constructor(input: string) {
            const counts = _.countBy(input.toLowerCase().split(/\s+/))
            const coeffs: [number, Emoji][] = []
            this.scale = 1
            this.haveSet = new Set()
            for (const [a, k] of Object.entries(counts)) {
                if (!abbr_to_em[a]) {
                    if (this.scale == 1 && /^[2-9]|[1-9][0-9]$/.test(a)) {
                        this.scale = +a
                    }
                } else {
                    coeffs.push([-Math.pow(-1, k) * (1 + ((k - 1) >> 1)), abbr_to_em[a]])
                    this.haveSet.add(a)
                }
            }
            // console.log(coeffs.map(x => `${x[0]} ${x[1].abbr}`))
            this.coeffs = _.sortBy(coeffs, e => [-e[0], e[1].rank])
        }

        value(): Vector {
            if (this.val) return this.val
            const val = this.coeffs[0][1].vec.clone();
            val.imul(this.coeffs[0][0])
            for (const [k, e] of this.coeffs.slice(1)) {
                val.imac(e.vec, k)
            }
            val.imul(1 / this.scale)
            return this.val = val
        }

        nearest() {
            const v = this.value()
            return <Emoji>_.minBy(em8, e => this.haveSet.has(e.abbr) ? Infinity : v.distCmp(e.vec))
        }
    }

    @Component
    class Vis extends Vue {
        @Prop()
        value!: Vector

        $el!: HTMLCanvasElement

        render(createElement: typeof Vue.prototype.$createElement) {
            return createElement('canvas', { value: this.$props.value })
        }

        mounted() {
            this.$el.width = 120
            this.$el.height = 40
            this.draw()
        }
        updated() {
            this.draw()
        }
        draw() {
            let ctx = this.$el.getContext('2d')
            if (ctx) {
                if (this.$props.value) {
                    stats.renderCanvas(ctx, this.$props.value, this.$el.height / 4)
                } else {
                    ctx.clearRect(0, 0, this.$el.width, this.$el.height)
                }
            }
        }
    }

    @Component
    class eq extends Vue {
        @Prop()
        eq!: equation

        render(createElement: typeof Vue.prototype.$createElement) {
            if (!this.eq.coeffs.length) {
                return createElement('br');
            }
            let children = [];
            for (let [c, e] of this.eq.coeffs) {
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
                children.push(e)
            }

            const value = this.eq.value()
            const result = this.eq.nearest()
            const dist = value.dist(result.vec)
            const eff = Math.floor(100 - Math.min(100, 5 * this.eq.scale + 20 * (dist / result.vec.mag() + dist / value.mag())))
            const scale = this.eq.scale

            let ret = children.map(x => x instanceof Object ?
                createElement(E, { props: { em: x } }) : x)
            ret.push(
                ' = ' + (scale != 1 ? scale : ''),
                createElement(E, { props: { em: result } }), result.abbr,
                createElement('span', { 'class': 'estat' }, ` (dist: ${Math.round(dist * 100) / 100}, efficiency: ${eff}%)`),
                createElement('br'), (scale != 1 ? '(' : ''),
                ...children.map((x => x instanceof Object ?
                    createElement(Vis, { props: { value: x.vec } }) : x)),
                (scale != 1 ? `) / ${scale} = ` : ' = '),
                createElement(Vis, { props: { value: value } }),
                " ≈ ",
                createElement(Vis, { props: { value: result.vec } }))

            return createElement('span', ret)
        }
    }

    let vm = new Vue({
        el: "#app",
        template: `<div>
            <eq :eq="new equation(inp)" class="eq" /><br>
            <input id="repl" v-model="inp" type="text" placeholder="enter recipe" />
            <div class="legend">
            <template  v-for="em in ems">
                <v-popover trigger="hover" ref="pop">
                    <div class="tooltip-target">
                        {{ em.abbr }}<br><E :em="em"/>
                    </div>
                    <template slot="popover">
                        <Vis :value="em.vec" />
                    </template>
                </v-popover>
                </template>
            </div>
        </div>`,
        data: {
            inp: "ta m 3",
            ems: em8,
        },
        components: {
            eq, Vis
        },
        methods: {
            equation: equation,
        }
    });

    Object.assign(window, { app: vm, em8, abbr_to_em, eq: equation })
}


load()
