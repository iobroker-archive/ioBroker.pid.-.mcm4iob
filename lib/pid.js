/*
 * pid controller
 *
 * This pid controller operates based on the following formula:
 *
 *  Y = (MAX-MIN) * XP * ( DIFF + 1/TN * INTEG(DIFF) + TV * DERIV(DIFF)) + OFFSET
 *  Y = KP * ( DIFF + 1/TN * INTEG(DIFF) + TV * DERIV(DIFF)) + OFFSET
 *
 */
'use strict';

class PidCtrl {
    constructor(pThis, pObj) {
        const max = this._isNumber(pObj.max) ? pObj.max : 100;
        const min = this._isNumber(pObj.min) ? pObj.min : 0;
        if (max <= min) throw new Error(`[pid.js] bad parameter - max must be greater then min `);

        let kp;
        let xp;
        if (this._isNumber(pObj.kp)) {
            if (this._isNumber(pObj.xp)) {
                throw new Error(`[pid.js] bad parameter - specify either kp or xp but not both`);
            } else {
                if (pObj.kp <= 0) throw new Error(`[pid.js] bad parameter - kp (${pObj.kp}) must be positive`);
                kp = pObj.kp;
                xp = (max - min) / kp;
            }
        } else {
            if (!this._isNumber(pObj.xp)) {
                throw new Error(`[pid.js] bad parameter - either kp or xp are required`);
            } else {
                if (pObj.xp <= 0) throw new Error(`[pid.js] bad parameter - xp (${pObj.xp}) must be positive`);
                xp = pObj.xp;
                kp = (max - min) / xp;
            }
        }

        const tn = this._isNumber(pObj.tn) ? pObj.tn : 0;
        const tv = this._isNumber(pObj.tv) ? pObj.tv : 0;
        const off = this._isNumber(pObj.off) ? pObj.off : 0;
        const sup = this._isNumber(pObj.sup) ? pObj.sup : 0;

        this.param = {
            xp: xp,
            kp: kp,
            tn: tn,
            tv: tv,

            min: min, // minimum output value
            max: max, // maximum output value

            off: off, // offset
            sup: sup, // suppression (hysteresis) value

            set: 0, // setpoint value

            dao: pObj.dao || false,
            inv: pObj.inv || false,
            useXp: pObj.useXp || false,
        };

        this.adapter = this;

        this.act = 0;

        this.sumErr = 0;
        this.lastErr = 0;
        this.lastTs = 0;
        this.lastDt = 0;
        this.lim = false;
    }

    /*
    set(pObj) {
        for (const key in pObj) {
            if (typeof this.data[key] === 'undefined') {
                throw new Error(`[pid.js] unexpected key ${key} encountered - report to developer`);
            }
            this.data[key] = pObj[key];
       }
    }
    */

    // getter
    getParams() {
        return this.param;
    }

    // setter
    setKp(pKp) {
        this.param.kp = pKp;
        this.param.xp = (this.param.max - this.param.min) / pKp;
    }

    setXp(pXp) {
        this.param.xp = pXp;
        this.param.kp = (this.param.max - this.param.min) / pXp;
    }

    setTn(pTn) {
        this.param.tn = pTn;
    }

    setTv(pTv) {
        this.param.tv = pTv;
    }

    setMax(pMax) {
        this.param.max = pMax;
        if (this.param.useXp) {
            this.param.kp = (this.param.max - this.param.min) / this.param.xp;
        } else {
            this.param.xp = (this.param.max - this.param.min) / this.param.kp;
        }
    }

    setMin(pMin) {
        this.param.min = pMin;
        if (this.param.useXp) {
            this.param.kp = (this.param.max - this.param.min) / this.param.xp;
        } else {
            this.param.xp = (this.param.max - this.param.min) / this.param.kp;
        }
    }

    setOff(pOff) {
        this.param.off = pOff;
    }

    setSet(pSet) {
        this.param.set = pSet;
    }

    setSup(pSup) {
        this.param.sup = pSup;
    }

    setAct(pAct) {
        this.act = pAct;
    }

    //  Y = (MAX-MIN) * XP * ( DIFF + 1/TN * INTEG(DIFF) + TV * DERIV(DIFF)) + OFFSET
    //  Y =             KP * ( DIFF + 1/TN * INTEG(DIFF) + TV * DERIV(DIFF)) + OFFSET
    //
    update() {
        // Calculate dt
        const now = Date.now();
        const dt = this.lastTs ? (now - this.lastTs) / 1000 : 0;

        if (typeof this.lastAct === 'undefined') this.lastAct = this.act;

        this.err = this.param.set - this.act;
        const diff = this.err;
        let supr = false;
        if (Math.abs(this.err) <= this.param.sup) {
            this.err = 0; // ignore error for now
            supr = true;
        }

        if (this.param.tn) {
            this.sumErr = this.sumErr + (this.err * dt) / this.param.tn;
        } else {
            this.sumErr = null;
        }

        if (this.param.tv && dt > 0) {
            if (this.param.dao) {
                this.diffErr = (this.act - this.lastAct) / dt;
            } else {
                this.diffErr = (this.err - this.lastErr) / dt;
            }
        } else {
            this.diffErr = null;
        }

        // calculate output value
        const e = this.err;
        const kp = this.param.kp;
        const tn = this.param.tn;
        const tv = this.param.tv;

        //this.y = kp * (e + this.sumErr/tn + tv*this.diffErr) + this.param.off;
        this.y = kp * e;
        //if (tn) this.y = this.y + (kp * this.sumErr) / tn;
        if (tn) this.y = this.y + kp * this.sumErr;
        if (tv) this.y = this.y + kp * tv * this.diffErr;
        if (this.param.inv) this.y = -this.y;
        this.y = this.y + this.param.off;

        // handle range limit
        this.lim = false;
        if (this.y > this.param.max) {
            if (tn) {
                if (this.param.inv) {
                    this.sumErr = (-this.param.max - this.param.off) / kp - e - tv * this.diffErr;
                } else {
                    this.sumErr = (this.param.max - this.param.off) / kp - e - tv * this.diffErr;
                }
            }
            this.y = this.param.max;
            this.lim = true;
        }
        if (this.y < this.param.min) {
            if (tn) {
                if (this.param.inv) {
                    this.sumErr = (-this.param.min - this.param.off) / kp - e - tv * this.diffErr;
                } else {
                    this.sumErr = (this.param.min - this.param.off) / kp - e - tv * this.diffErr;
                }
            }
            this.y = this.param.min;
            this.lim = true;
        }

        // prepare next cycle
        this.lastTs = now;
        this.lastAct = this.act;
        this.lastErr = this.err;
        this.lastDt = dt * 1000; //ms again

        const ret = {
            ts: this.lastTs,
            act: this.act,
            set: this.param.set,
            diff: diff,
            off: this.param.off,
            err: this.err,
            y: this.y,
            lim: this.lim,
            dt: this.lastDt,
            differr: this.diffErr,
            sumerr: this.sumErr,
            supr: supr,
        };

        return ret;
    }

    reset() {
        this.sumErr = 0;
    }

    restart() {
        this.lastTs = 0;
    }

    _isNumber(p) {
        return typeof p === 'number' && p !== null && !isNaN(p);
    }
}

module.exports = PidCtrl;
