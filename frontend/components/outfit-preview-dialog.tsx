'use client';

import { useState } from 'react';
import { ChevronLeft, ChevronRight, X, RotateCcw, RotateCw, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { type Outfit } from '@/lib/hooks/use-outfits';
import { useRotateImage } from '@/lib/hooks/use-items';
import { toast } from 'sonner';
import Image from 'next/image';

interface OutfitPreviewDialogProps {
  outfit: Outfit;
  open: boolean;
  onClose: () => void;
}

export function OutfitPreviewDialog({ outfit, open, onClose }: OutfitPreviewDialogProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [imageKey, setImageKey] = useState(0); // Force image reload after rotation
  const items = outfit.items;
  const rotateImage = useRotateImage();

  const currentItem = items[currentIndex];

  const goToPrev = () => {
    setCurrentIndex((prev) => (prev === 0 ? items.length - 1 : prev - 1));
  };

  const goToNext = () => {
    setCurrentIndex((prev) => (prev === items.length - 1 ? 0 : prev + 1));
  };

  const handleRotate = async (direction: 'cw' | 'ccw') => {
    try {
      await rotateImage.mutateAsync({ id: currentItem.id, direction });
      setImageKey((k) => k + 1); // Force image reload
      toast.success('Image rotated');
    } catch {
      toast.error('Failed to rotate image');
    }
  };

  if (!currentItem) return null;

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-w-lg p-0 overflow-hidden max-h-[90vh] flex flex-col [&>button]:hidden">
        {/* Header - sticky */}
        <div className="flex items-center justify-between p-4 pb-2 border-b flex-shrink-0">
          <div>
            <h2 className="text-lg font-semibold capitalize">{outfit.occasion} Outfit</h2>
            <p className="text-sm text-muted-foreground">
              {currentIndex + 1} / {items.length}
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} className="rounded-full -mr-2">
            <X className="h-5 w-5" />
          </Button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto overscroll-contain">
          {/* Main image area */}
          <div className="relative bg-muted">
            {/* Image - smaller on mobile */}
            <div className="relative aspect-square w-full max-h-[280px] sm:max-h-[350px]">
              {currentItem.thumbnail_path || currentItem.image_path ? (
                <Image
                  key={`${currentItem.id}-${imageKey}`}
                  src={`/api/v1/images/${currentItem.image_path}?v=${imageKey}`}
                  alt={currentItem.name || currentItem.type}
                  fill
                  className="object-contain"
                  sizes="(max-width: 512px) 100vw, 512px"
                  priority
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                  No image
                </div>
              )}
            </div>

            {/* Navigation arrows */}
            {items.length > 1 && (
              <>
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute left-2 top-1/2 -translate-y-1/2 bg-background/80 hover:bg-background/90 rounded-full"
                  onClick={goToPrev}
                >
                  <ChevronLeft className="h-6 w-6" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute right-2 top-1/2 -translate-y-1/2 bg-background/80 hover:bg-background/90 rounded-full"
                  onClick={goToNext}
                >
                  <ChevronRight className="h-6 w-6" />
                </Button>
              </>
            )}
          </div>

          {/* Item details */}
          <div className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="secondary" className="capitalize">
                  {currentItem.type}
                </Badge>
                {currentItem.subtype && (
                  <Badge variant="outline" className="capitalize">
                    {currentItem.subtype}
                  </Badge>
                )}
                {currentItem.primary_color && (
                  <Badge
                    variant="outline"
                    className="capitalize"
                    style={{
                      borderColor: currentItem.primary_color,
                      backgroundColor: `${currentItem.primary_color}20`,
                    }}
                  >
                    {currentItem.primary_color}
                  </Badge>
                )}
              </div>
              {/* Rotate buttons */}
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => handleRotate('ccw')}
                  disabled={rotateImage.isPending}
                  title="Rotate left"
                  className="h-8 w-8"
                >
                  {rotateImage.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RotateCcw className="h-4 w-4" />
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => handleRotate('cw')}
                  disabled={rotateImage.isPending}
                  title="Rotate right"
                  className="h-8 w-8"
                >
                  {rotateImage.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RotateCw className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>
            {currentItem.name && (
              <p className="font-medium">{currentItem.name}</p>
            )}
          </div>

          {/* Thumbnail strip */}
          {items.length > 1 && (
            <div className="border-t p-3">
              <div className="flex gap-2 overflow-x-auto">
                {items.map((item, index) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setCurrentIndex(index)}
                    className={`relative w-14 h-14 rounded overflow-hidden flex-shrink-0 border-2 transition-colors ${
                      index === currentIndex
                        ? 'border-primary'
                        : 'border-transparent hover:border-muted-foreground/50'
                    }`}
                  >
                    {item.thumbnail_path ? (
                      <Image
                        src={`/api/v1/images/${item.thumbnail_path}?v=${imageKey}`}
                        alt={item.name || item.type}
                        fill
                        className="object-cover"
                        sizes="56px"
                      />
                    ) : (
                      <div className="w-full h-full bg-muted flex items-center justify-center text-xs text-muted-foreground">
                        {item.type.charAt(0).toUpperCase()}
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Outfit details section */}
          {(outfit.reasoning || outfit.highlights || outfit.style_notes) && (
            <div className="border-t p-4 space-y-3">
              {outfit.reasoning && (
                <p className="font-medium text-foreground">{outfit.reasoning}</p>
              )}
              {outfit.highlights && outfit.highlights.length > 0 && (
                <ul className="space-y-1.5">
                  {outfit.highlights.map((highlight, index) => (
                    <li key={index} className="flex items-start gap-2 text-sm text-muted-foreground">
                      <span className="text-primary mt-0.5">•</span>
                      <span>{highlight}</span>
                    </li>
                  ))}
                </ul>
              )}
              {outfit.style_notes && (
                <div className="p-3 bg-muted rounded-lg border">
                  <p className="text-sm text-muted-foreground">
                    <span className="font-medium text-foreground">Tip:</span> {outfit.style_notes}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Close button at bottom - always visible */}
        <div className="border-t p-3 flex-shrink-0">
          <Button variant="outline" className="w-full" onClick={onClose}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
