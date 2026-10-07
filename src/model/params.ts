import type { VirusPreset } from './types';

// Conversion (shown in Math panel):
// sigma = 1/L, gamma+mu = 1/T, mu = p/T, gamma = (1-p)/T,
// beta = R0/T, betaAir = a*beta, betaContact = (1-a)*beta.

export interface PresetInputs { R0: number; L: number; T: number; p: number; a: number; }

export function presetToRates(inp: PresetInputs) {
  const sigma = 1 / inp.L;
  const mu = inp.p / inp.T;
  const gamma = (1 - inp.p) / inp.T;
  const beta = inp.R0 / inp.T;
  const betaAir = inp.a * beta;
  const betaContact = (1 - inp.a) * beta;
  return { sigma, gamma, mu, beta, betaAir, betaContact };
}

export function ratesToDerived(betaAir: number, betaContact: number, gamma: number, mu: number, sigma: number) {
  const R0 = (betaAir + betaContact) / (gamma + mu);
  const p = mu / (gamma + mu);
  const L = 1 / sigma;
  const T = 1 / (gamma + mu);
  return { R0, p, L, T };
}

export function presetInputsFromVirus(v: VirusPreset): PresetInputs {
  return {
    R0: v.R0_preset,
    L: v.latent_L_days_preset,
    T: v.infectious_T_days_preset,
    p: v.death_share_p_preset,
    a: v.airborne_share_a,
  };
}

export function virusToRates(v: VirusPreset) {
  return presetToRates(presetInputsFromVirus(v));
}

export function checkPresetConversion(v: VirusPreset, tol = 0.02): boolean {
  const c = virusToRates(v);
  const close = (x: number, y: number) => Math.abs(x - y) <= tol * Math.max(1, Math.abs(y));
  return (
    close(c.sigma, v.sigma) &&
    close(c.gamma, v.gamma) &&
    close(c.mu, v.mu) &&
    close(c.betaAir, v.beta_air) &&
    close(c.betaContact, v.beta_contact)
  );
}
