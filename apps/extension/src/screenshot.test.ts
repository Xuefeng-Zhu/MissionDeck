import {expect,it} from 'vitest';
import {validateCrop} from './screenshot';
it('accepts an explicit bounded crop and rejects out-of-image or fractional coordinates',()=>{expect(validateCrop({x:10,y:20,width:30,height:40},100,100)).toEqual({x:10,y:20,width:30,height:40});for(const crop of [{x:-1,y:0,width:1,height:1},{x:99,y:0,width:2,height:1},{x:0,y:0,width:1,height:101},{x:0,y:0,width:0,height:1},{x:0.5,y:0,width:1,height:1},{x:NaN,y:0,width:1,height:1}])expect(()=>validateCrop(crop,100,100)).toThrow('Crop');});
