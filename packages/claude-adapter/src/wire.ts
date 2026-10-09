// Bounded decoding mechanics only. No vendor wire profile has been qualified for effective effort.
import { strictJson } from '../../codex-adapter/src/safe.js';
import { LIMITS,inert,refuse } from './policy.js';
import { LaunchError,requireLaunch } from './boundary.js';
export const WIRE_PROFILE='claude-json-unqualified/v1';
export function decodeEnvelope(bytes:Uint8Array):unknown {
  try{requireLaunch(bytes instanceof Uint8Array&&bytes.byteLength<=LIMITS.stdoutBytes);const text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);
    requireLaunch(Buffer.from(text).equals(Buffer.from(bytes)));return inert(strictJson(text,LIMITS.stdoutBytes));
  }catch{throw new LaunchError();}
}
export class ClaudeWire {
  readonly #chunks:Buffer[]=[];#bytes=0;#closed=false;
  feed(data:Buffer):void{requireLaunch(!this.#closed&&Buffer.isBuffer(data));this.#bytes+=data.length;requireLaunch(this.#bytes<=LIMITS.stdoutBytes);this.#chunks.push(Buffer.from(data));}
  finish(_expected:unknown):never{
    requireLaunch(!this.#closed);this.#closed=true;decodeEnvelope(Buffer.concat(this.#chunks,this.#bytes));
    // Even well-formed JSON is not effective provider metadata. A separately reviewed fixed profile
    // must replace this refusal; no request flag/local selection/model text supplies missing evidence.
    return refuse('EFFECTIVE_EVIDENCE');
  }
}
