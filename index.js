/*!
 *
 * @name Mind Wobbles
 *
 */

var bpm = 130;
var tuning = 440;
var transpose = 11;
var hardcodedTimer = 7.4;
var sampleRate = 44100;

// constants
var tau = 2 * Math.PI;

// time coefficients
var t, tt;

function Oscillator(type, size, alias) {
    if (!(this instanceof Oscillator)) return new Oscillator(type, size, alias);
    this.pos = 0;
    this.size = size || sampleRate;
    this.coeff = this.size / sampleRate;
    this.table = new Float32Array(this.size);
    this.alias = alias === false ? false : true;
    this.build(type);
}

Oscillator.prototype.build = function(type) {
    switch (type) {
        case 'sin':
            var scale = 2 * Math.PI / this.size;
            for (var i = 0; i < this.size; i++) {
                this.table[i] = Math.sin(i * scale);
            }
            break;

        case 'saw':
            for (var i = 0; i < this.size; i++) {
                var x = (i / this.size);
                this.table[i] = +2.0 * (x - Math.round(x));
            }
            break;

        case 'ramp':
            for (var i = 0; i < this.size; i++) {
                var x = (i / this.size);
                this.table[i] = -2.0 * (x - Math.round(x));
            }
            break;

        case 'tri':
            for (var i = 0; i < this.size; i++) {
                var x = (i / this.size) - 0.25;
                this.table[i] = 1.0 - 4.0 * Math.abs(Math.round(x) - x);
            }
            break;

        case 'sqr':
            var half = this.size / 2;
            for (var i = 0; i < this.size; i++) {
                this.table[i] = i < half ? +1 : -1;
            }
            break;
    }
};

Oscillator.prototype.play = function(freq) {
    this.pos += freq * this.coeff;
    if (this.pos >= this.size) this.pos -= this.size;
    this.index = this.pos | 0;
    if (!this.alias) return this.table[this.index];
    this.alpha = this.pos - this.index;
    this.next = this.table[this.index == this.size - 1 ? 0 : this.index + 1];
    this.curr = this.table[this.index];
    return this.curr + (this.next - this.curr) * this.alpha;
};

function clock(_t) {
    t = _t;
    t *= bpm / 120;
    tt = tau * t;
}

function octave(o) {
    return function(n) {
        return n * o;
    };
}

function slide(measure, seq, speed) {
    var pos = (t / measure / 2) % seq.length;
    var now = pos | 0;
    var next = now + 1;
    var alpha = pos - now;
    if (next == seq.length) next = 0;
    return seq[now] + ((seq[next] - seq[now]) * Math.pow(alpha, speed));
}

function sequence(measure, seq) {
    return seq[(t / measure / 2 | 0) % seq.length];
}

function arp(measure, x, y, z) {
    var ts = t / 2 % measure;
    return Math.sin(x * (Math.exp(-ts * y))) * Math.exp(-ts * z);
}

function sin(freq, phase) {
    return Math.sin((t * freq + (2 - (phase || 0) / 2)) * tau);
}

function saw(freq) {
    return 1 - 2 * (t % (1 / freq)) * freq;
}

function tri(freq) {
    return Math.abs(1 - (2 * t * freq) % 2) * 2 - 1;
}

function sqr(freq) {
    return sin(freq, t) > 0 ? 1 : -1;
}

function Noise() {
    return Math.random() * 2 - 1;
}

function note(n, octave) {
    return Math.pow(2, (
    n + transpose - 33 + (12 * (octave || 0))) / 12) * tuning; // A4 tuning
}

function clip(x) {
    return x / (1 + Math.abs(x));
}

function DiodeFilter() {
    this.k = 0;
    this.A = 0;
    this.z = [0, 0, 0, 0, 0];
    this.ah;
    this.bh;
    this.fc;
    this.set_q(0);
    this.set_hpf(0.5);
    this.set_fc(.5);
}

DiodeFilter.prototype.set_hpf = function(fc) {
    var K = fc * Math.PI;
    this.ah = (K - 2) / (K + 2);
    this.bh = 2 / (K + 2);
};

DiodeFilter.prototype.reset = function() {
    if (this.k < 17) this.z = [0, 0, 0, 0, 0];
};

DiodeFilter.prototype.set_q = function(q) {
    this.k = 20 * q;
    this.A = 1 + 0.5 * this.k;
};

DiodeFilter.prototype.set_fc = function(cutoff) {
    cutoff = (cutoff * cutoff);
    this.fc = cutoff <= 0 ? .02 : (cutoff >= 1.0 ? .999 : cutoff);
};

DiodeFilter.prototype.run = function(x) {
    var a = Math.PI * this.fc;
    a = 2 * Math.tan(0.5 * a); // dewarping, not required with 2x oversampling
    var ainv = 1 / a;
    var a2 = a * a;
    var b = 2 * a + 1;
    var b2 = b * b;
    var c = 1 / (2 * a2 * a2 - 4 * a2 * b2 + b2 * b2);
    var g0 = 2 * a2 * a2 * c;
    var g = g0 * this.bh;

    // current state
    var s0 = (a2 * a * this.z[0] + a2 * b * this.z[1] + this.z[2] * (b2 - 2 * a2) * a + this.z[3] * (b2 - 3 * a2) * b) * c;
    var s = this.bh * s0 - this.z[4];

    // solve feedback loop (linear)
    var y5 = (g * x + s) / (1 + g * this.k);

    // input clipping
    var y0 = clip(x - this.k * y5);
    y5 = g * y0 + s;

    // compute integrator outputs
    var y4 = g0 * y0 + s0;
    var y3 = (b * y4 - this.z[3]) * ainv;
    var y2 = (b * y3 - a * y4 - this.z[2]) * ainv;
    var y1 = (b * y2 - a * y3 - this.z[1]) * ainv;

    // update filter state
    this.z[0] += 4 * a * (y0 - y1 + y2);
    this.z[1] += 2 * a * (y1 - 2 * y2 + y3);
    this.z[2] += 2 * a * (y2 - 2 * y3 + y4);
    this.z[3] += 2 * a * (y3 - 2 * y4);
    this.z[4] = this.bh * y4 + this.ah * y5;

    return this.A * y4;
};

// patterns
var hat_pattern = [
0.8, 0.3, 0.2, 0.1, 0.3, 0.1, 1.1, 0.1,
0.8, 0.4, 0.1, 0.1, 0.3, 0.2, 1.2, 0.1, ];
var crash_pattern = [
0, 0, 0, 0, 2, 1, .5, .25];

var melody = [2, 9, 5, 8, 2, 9, 5, 2].map(function(n) {
    return note(n, 2);
});

melody = melody.concat(melody.slice().reverse());

var hat_note = note(16, 6);

var bass_osc = Oscillator('sin', 512);
var bass2_osc = Oscillator('sin', 512);
var bass3_osc = Oscillator('sin', 512);
var osc = Oscillator('tri', 512);
var osc2 = Oscillator('tri', 512);
var hat_osc = Oscillator('ramp', 512);

var filter = new DiodeFilter();
var filter2 = new DiodeFilter();

filter.set_q(0.23);
filter.set_hpf(.0011);

export function dsp(t) {
    clock(t);

    var noise = Noise();

    var n = slide(1 / 4, melody, 32);

    var synth_osc = osc.play(n + tri(24) * 2) + tri(n / 10000);
    var synth_osc2 = osc2.play(n + tri(24) * 2) + tri(n / 10000);
    var synth = arp(1 / 16, synth_osc, 1000, 1);
    var synth2 = arp(1 / 16, synth_osc, 100, 1);
    var synth3 = arp(1 / n, synth_osc2, 100, 1);

    filter.set_fc(0.5 + (tri(1 / 2) * 0.02));
    var b = slide(1 / 8, melody, 32);
    var bass = bass_osc.play(b / 8);
    bass = filter.run(bass * 2);
    bass = clip(bass * 10);
    bass = bass * (0.8 - ((tri(8) * 0.5)));
    var bass2 = bass2_osc.play(b / 16);
    bass2 = filter2.run(bass2 * 1);
    bass2 = clip(bass2 * 2);
    bass2 = bass2 * (.8 - ((tri(4) * .5)));
    var bass3 = bass3_osc.play(b / 4);
    bass3 = filter2.run(bass3 * 1);
    bass3 = clip(bass3 * n);
    bass3 = bass3 * (.8 - ((tri(8) * .5)));

    var kick = arp(1 / 2, 50, 40, 0);
    var kick2 = arp(1 / 1, 50, 40, 0);

    var hat = sequence(1 / 4, hat_pattern) * arp(1 / 16, hat_osc.play(hat_note) + noise * 1.8, 2, 70);
    var crash = sequence(1 / 8, crash_pattern) * arp(1 / 4, hat_osc.play(hat_note) + noise * 2, 20, 20);

    var gotBass = (t - (hardcodedTimer * 2)) / hardcodedTimer; // start fading in the bass after we've been around twice
    if (gotBass < 0) gotBass = 0;
    if (gotBass > 1) gotBass = 1;
    var gotKick = 0;
    var gotSynth = 1;
    var gotSynth2 = 0;
    var gotSynth3 = (t - (hardcodedTimer * 4)) / hardcodedTimer; // Fade in extra crunch after 4 times
    if (t > hardcodedTimer) gotKick = 1; // wait once and add the kick
    if (t > hardcodedTimer) gotSynth2 = 1; // wait once and add second synth track
    if (gotSynth3 < 0) gotSynth3 = 0;
    if (gotSynth3 > 1) gotSynth3 = 1;
    
    if (t > (hardcodedTimer * 6)) { // after 6 times, start alternating the tap and the crunch in the synth
      if (Math.floor(t) % 2 === 0 ) {
        gotSynth3 = t%2;
        gotSynth = 1-t%2;
      }
      else {
        gotSynth3 = 1-t%2;
        gotSynth = t%2;
        
      }
    }
    
    return 0.5 * (
      2 * (synth2 * gotSynth2)
    + 1 * (synth3 * gotSynth3)
    + 2 * (synth * gotSynth)
    + 3 * (kick * gotKick)
    //+ 5 * (kick2 * gotKick)
    + 0.35 * hat
    + .5 * (bass * gotBass)
    + 2 * (bass2 * gotBass)
    + .2 * (bass3 * gotBass)
    + 0.5 * (crash * gotKick)
    );
}