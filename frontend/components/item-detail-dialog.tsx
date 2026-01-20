'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import {
  Heart,
  Pencil,
  Trash2,
  X,
  Loader2,
  Calendar,
  Tag,
  Palette,
  Shirt,
  Sparkles,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Layers,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { useUpdateItem, useDeleteItem, useReanalyzeItem, useRotateImage } from '@/lib/hooks/use-items';
import { Item, CLOTHING_TYPES, CLOTHING_COLORS } from '@/lib/types';
import { ColorEyedropper } from '@/components/color-eyedropper';
import { GeneratePairingsDialog } from '@/components/generate-pairings-dialog';

interface ItemDetailDialogProps {
  item: Item | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function getImageUrl(path: string | undefined) {
  if (!path) return '/placeholder.svg';
  return `/api/v1/images/${path}`;
}

export function ItemDetailDialog({ item, open, onOpenChange }: ItemDetailDialogProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showPairingsDialog, setShowPairingsDialog] = useState(false);
  const [imageKey, setImageKey] = useState(0);
  const [editForm, setEditForm] = useState({
    name: '',
    type: '',
    subtype: '',
    brand: '',
    primary_color: '',
    notes: '',
    favorite: false,
  });

  const updateItem = useUpdateItem();
  const deleteItem = useDeleteItem();
  const reanalyzeItem = useReanalyzeItem();
  const rotateImage = useRotateImage();

  useEffect(() => {
    if (item) {
      setEditForm({
        name: item.name || '',
        type: item.type,
        subtype: item.subtype || '',
        brand: item.brand || '',
        primary_color: item.primary_color || '',
        notes: item.notes || '',
        favorite: item.favorite,
      });
      setIsEditing(false);
    }
  }, [item]);

  if (!item) return null;

  const handleSave = async () => {
    try {
      await updateItem.mutateAsync({
        id: item.id,
        data: {
          name: editForm.name || undefined,
          type: editForm.type,
          subtype: editForm.subtype || undefined,
          brand: editForm.brand || undefined,
          primary_color: editForm.primary_color || undefined,
          notes: editForm.notes || undefined,
          favorite: editForm.favorite,
        },
      });
      setIsEditing(false);
    } catch (error) {
      console.error('Failed to update item:', error);
    }
  };

  const handleDelete = async () => {
    try {
      await deleteItem.mutateAsync(item.id);
      setShowDeleteConfirm(false);
      onOpenChange(false);
      toast.success('Item deleted', {
        description: item.name ? `"${item.name}" has been removed.` : 'Item removed from your wardrobe.',
      });
    } catch (error) {
      console.error('Failed to delete item:', error);
      toast.error('Failed to delete', {
        description: 'Something went wrong. Please try again.',
      });
    }
  };

  const handleToggleFavorite = async () => {
    try {
      await updateItem.mutateAsync({
        id: item.id,
        data: { favorite: !item.favorite },
      });
    } catch (error) {
      console.error('Failed to toggle favorite:', error);
    }
  };

  const handleReanalyze = async () => {
    try {
      await reanalyzeItem.mutateAsync(item.id);
      // Status will update to 'processing' and UI will reflect it
    } catch (error) {
      console.error('Failed to trigger re-analysis:', error);
    }
  };

  const handleRotate = async (direction: 'cw' | 'ccw') => {
    try {
      await rotateImage.mutateAsync({ id: item.id, direction });
      setImageKey((k) => k + 1);
      toast.success('Image rotated');
    } catch (error) {
      console.error('Failed to rotate image:', error);
      toast.error('Failed to rotate image');
    }
  };

  const isAnalyzing = reanalyzeItem.isPending || item.status === 'processing';

  // Use original image for better quality in detail view
  const imageUrl = getImageUrl(item.image_path);
  const colorInfo = CLOTHING_COLORS.find((c) => c.value === item.primary_color);
  const typeInfo = CLOTHING_TYPES.find((t) => t.value === item.type);

  // AI-generated tags
  const tags = item.tags || {};
  const hasAiTags = !!(tags.colors?.length || tags.pattern || tags.material ||
                   tags.style?.length || tags.season?.length || tags.formality || tags.fit ||
                   tags.occasion?.length || tags.condition || tags.features?.length);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] flex flex-col p-0 overflow-hidden [&>button]:hidden">
          {/* Header - sticky */}
          <DialogHeader className="flex flex-row items-center justify-between space-y-0 p-4 border-b flex-shrink-0">
            <DialogTitle className="text-xl">
              {item.name || typeInfo?.label || item.type}
            </DialogTitle>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                onClick={handleToggleFavorite}
                disabled={updateItem.isPending}
                title="Toggle favorite"
              >
                <Heart
                  className={`h-5 w-5 ${
                    item.favorite ? 'fill-red-500 text-red-500' : 'text-muted-foreground'
                  }`}
                />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setShowPairingsDialog(true)}
                disabled={item.status !== 'ready'}
                title="Find matching outfits"
              >
                <Layers className="h-5 w-5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleReanalyze}
                disabled={isAnalyzing}
                title={isAnalyzing ? 'Analysis in progress...' : 'Re-analyze with AI'}
              >
                <RefreshCw
                  className={`h-5 w-5 ${isAnalyzing ? 'animate-spin text-primary' : ''}`}
                />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => handleRotate('ccw')}
                disabled={rotateImage.isPending}
                title="Rotate left"
              >
                {rotateImage.isPending ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <RotateCcw className="h-5 w-5" />
                )}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => handleRotate('cw')}
                disabled={rotateImage.isPending}
                title="Rotate right"
              >
                {rotateImage.isPending ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <RotateCw className="h-5 w-5" />
                )}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setIsEditing(!isEditing)}
                title={isEditing ? 'Cancel editing' : 'Edit item'}
              >
                {isEditing ? (
                  <X className="h-5 w-5" />
                ) : (
                  <Pencil className="h-5 w-5" />
                )}
              </Button>
              <Button variant="ghost" size="icon" onClick={() => onOpenChange(false)} className="rounded-full" title="Close">
                <X className="h-5 w-5" />
              </Button>
            </div>
          </DialogHeader>

          {/* Scrollable content */}
          <div className="flex-1 overflow-y-auto overscroll-contain p-6 pt-4">
            <div className="grid gap-6 sm:grid-cols-2">
            {/* Image */}
            <div className="relative aspect-square bg-muted rounded-lg overflow-hidden">
              <Image
                key={imageKey}
                src={`${imageUrl}?v=${imageKey}`}
                alt={item.name || item.type}
                fill
                className="object-cover"
                sizes="(max-width: 640px) 100vw, 50vw"
              />
              {isAnalyzing && (
                <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center gap-2">
                  <Loader2 className="h-8 w-8 text-white animate-spin" />
                  <span className="text-white text-sm font-medium">AI Analyzing...</span>
                </div>
              )}
            </div>

            {/* Details */}
            <div className="space-y-4">
              {isEditing ? (
                // Edit form
                <div className="space-y-3">
                  <div className="space-y-2">
                    <Label>Name</Label>
                    <Input
                      value={editForm.name}
                      onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                      placeholder="Item name"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Type</Label>
                    <Select
                      value={editForm.type}
                      onValueChange={(v) => setEditForm({ ...editForm, type: v })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {CLOTHING_TYPES.map((t) => (
                          <SelectItem key={t.value} value={t.value}>
                            {t.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Brand</Label>
                    <Input
                      value={editForm.brand}
                      onChange={(e) => setEditForm({ ...editForm, brand: e.target.value })}
                      placeholder="Brand name"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Primary Color</Label>
                    <div className="flex gap-2">
                      <Select
                        value={editForm.primary_color}
                        onValueChange={(v) => setEditForm({ ...editForm, primary_color: v })}
                      >
                        <SelectTrigger className="flex-1">
                          <SelectValue placeholder="Select color" />
                        </SelectTrigger>
                        <SelectContent>
                          {CLOTHING_COLORS.map((c) => (
                            <SelectItem key={c.value} value={c.value}>
                              <div className="flex items-center gap-2">
                                <div
                                  className="w-3 h-3 rounded-full border"
                                  style={{ backgroundColor: c.hex }}
                                />
                                {c.name}
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <ColorEyedropper
                        imageUrl={imageUrl}
                        onColorSelect={(color) => setEditForm({ ...editForm, primary_color: color })}
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Notes</Label>
                    <Textarea
                      value={editForm.notes}
                      onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                      placeholder="Additional notes..."
                      rows={3}
                    />
                  </div>
                  <div className="flex gap-2 pt-2">
                    <Button
                      variant="outline"
                      className="flex-1"
                      onClick={() => setIsEditing(false)}
                    >
                      Cancel
                    </Button>
                    <Button
                      className="flex-1"
                      onClick={handleSave}
                      disabled={updateItem.isPending}
                    >
                      {updateItem.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      ) : null}
                      Save
                    </Button>
                  </div>
                </div>
              ) : (
                // View mode
                <div className="space-y-4">
                  {/* Basic info */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-sm">
                      <Shirt className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium">{typeInfo?.label || item.type}</span>
                      {item.subtype && (
                        <span className="text-muted-foreground">• {item.subtype}</span>
                      )}
                    </div>
                    {item.brand && (
                      <div className="flex items-center gap-2 text-sm">
                        <Tag className="h-4 w-4 text-muted-foreground" />
                        <span>{item.brand}</span>
                      </div>
                    )}
                    {colorInfo && (
                      <div className="flex items-center gap-2 text-sm">
                        <Palette className="h-4 w-4 text-muted-foreground" />
                        <div
                          className="w-4 h-4 rounded-full border"
                          style={{ backgroundColor: colorInfo.hex }}
                        />
                        <span>{colorInfo.name}</span>
                      </div>
                    )}
                    {item.wear_count > 0 && (
                      <div className="flex items-center gap-2 text-sm">
                        <Calendar className="h-4 w-4 text-muted-foreground" />
                        <span>
                          Worn {item.wear_count} time{item.wear_count !== 1 ? 's' : ''}
                          {item.last_worn_at && (
                            <span className="text-muted-foreground">
                              {' '}• Last: {new Date(item.last_worn_at).toLocaleDateString()}
                            </span>
                          )}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* AI Analysis */}
                  {(hasAiTags || item.ai_description) && item.status === 'ready' && (
                    <div className="space-y-2 pt-2 border-t">
                      <div className="flex items-center gap-2 text-sm font-medium">
                        <Sparkles className="h-4 w-4 text-primary" />
                        AI Analysis
                        {item.ai_confidence !== undefined && item.ai_confidence > 0 && (
                          <Badge variant="secondary" className="text-xs">
                            {Math.round(item.ai_confidence * 100)}% confident
                          </Badge>
                        )}
                      </div>
                      {item.ai_description && (
                        <p className="text-sm text-muted-foreground italic">
                          &ldquo;{item.ai_description}&rdquo;
                        </p>
                      )}
                      {hasAiTags && <div className="flex flex-wrap gap-1.5">
                        {tags.colors?.map((color) => (
                          <Badge key={color} variant="outline" className="text-xs">
                            {color}
                          </Badge>
                        ))}
                        {tags.pattern && (
                          <Badge variant="outline" className="text-xs">
                            {tags.pattern}
                          </Badge>
                        )}
                        {tags.material && (
                          <Badge variant="outline" className="text-xs">
                            {tags.material}
                          </Badge>
                        )}
                        {tags.style?.map((s) => (
                          <Badge key={s} variant="outline" className="text-xs">
                            {s}
                          </Badge>
                        ))}
                        {tags.season?.map((s) => (
                          <Badge key={s} variant="outline" className="text-xs">
                            {s}
                          </Badge>
                        ))}
                        {tags.formality && (
                          <Badge variant="outline" className="text-xs">
                            {tags.formality}
                          </Badge>
                        )}
                        {tags.fit && (
                          <Badge variant="outline" className="text-xs">
                            {tags.fit} fit
                          </Badge>
                        )}
                        {tags.occasion?.map((o: string) => (
                          <Badge key={o} variant="outline" className="text-xs">
                            {o}
                          </Badge>
                        ))}
                        {tags.condition && (
                          <Badge variant="outline" className="text-xs">
                            {tags.condition}
                          </Badge>
                        )}
                        {tags.features?.map((f: string) => (
                          <Badge key={f} variant="outline" className="text-xs">
                            {f}
                          </Badge>
                        ))}
                      </div>}
                    </div>
                  )}

                  {/* Notes */}
                  {item.notes && (
                    <div className="space-y-1 pt-2 border-t">
                      <p className="text-sm font-medium">Notes</p>
                      <p className="text-sm text-muted-foreground">{item.notes}</p>
                    </div>
                  )}

                  {/* Metadata */}
                  <div className="text-xs text-muted-foreground pt-2 border-t">
                    Added {new Date(item.created_at).toLocaleDateString()}
                  </div>
                </div>
              )}
            </div>
            </div>

            {/* Delete button - separated from other actions for safety */}
            {!isEditing && (
              <div className="pt-4 border-t mt-4">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive hover:bg-destructive/10"
                  onClick={() => setShowDeleteConfirm(true)}
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete this item
                </Button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this item?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete &ldquo;{item.name || item.type}&rdquo; from your
              wardrobe. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteItem.isPending}
            >
              {deleteItem.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : null}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Generate Pairings Dialog */}
      <GeneratePairingsDialog
        item={item}
        open={showPairingsDialog}
        onOpenChange={setShowPairingsDialog}
      />
    </>
  );
}
