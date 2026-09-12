export interface CropBounds {x:number;y:number;width:number;height:number}
export function validateCrop(crop:CropBounds,imageWidth:number,imageHeight:number):CropBounds {
 if(!Object.values(crop).every(Number.isSafeInteger)||crop.x<0||crop.y<0||crop.width<1||crop.height<1||crop.x+crop.width>imageWidth||crop.y+crop.height>imageHeight)throw new Error('Crop must use whole pixels and stay inside the image.');
 return crop;
}
