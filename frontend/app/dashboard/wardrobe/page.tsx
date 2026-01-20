'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import { Plus, Search, Heart, Grid3X3, Loader2, AlertCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { AddItemDialog } from '@/components/add-item-dialog';
import { ItemDetailDialog } from '@/components/item-detail-dialog';
import { BulkActionToolbar, BulkSelection } from '@/components/bulk-action-toolbar';
import { useItems, useItemTypes, useReanalyzeItem, useBulkDeleteItems, useBulkReanalyzeItems, BulkOperationParams } from '@/lib/hooks/use-items';
import { CLOTHING_TYPES, CLOTHING_COLORS, Item } from '@/lib/types';
import { toast } from 'sonner';

function getImageUrl(path: string | undefined) {
  if (!path) return '/placeholder.svg';
  return `/api/v1/images/${path}`;
}

function ItemCard({
  item,
  selected,
  onSelect,
  onRetry,
  onClick,
}: {
  item: Item;
  selected: boolean;
  onSelect: (id: string, checked: boolean) => void;
  onRetry?: (id: string) => void;
  onClick?: () => void;
}) {
  const colorInfo = CLOTHING_COLORS.find((c) => c.value === item.primary_color);
  const isProcessing = item.status === 'processing';
  const isError = item.status === 'error';
  const imageUrl = getImageUrl(item.thumbnail_path);

  const handleCheckboxClick = (e: React.MouseEvent) => {
    e.stopPropagation();
  };

  return (
    <Card
      className={`group overflow-hidden cursor-pointer transition-all ${
        selected ? 'ring-2 ring-primary shadow-md' : 'hover:shadow-md'
      }`}
      onClick={onClick}
    >
      <div className="relative aspect-square bg-muted">
        {item.thumbnail_path ? (
          <Image
            src={imageUrl}
            alt={item.name || item.type}
            fill
            className="object-cover"
            sizes="(max-width: 640px) 50vw, (max-width: 768px) 33vw, (max-width: 1024px) 25vw, 20vw"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-muted-foreground text-sm">
            {item.type}
          </div>
        )}
        {/* Checkbox in top-left */}
        <div
          className={`absolute top-2 left-2 z-10 transition-opacity ${
            selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
          }`}
          onClick={handleCheckboxClick}
        >
          <Checkbox
            checked={selected}
            onCheckedChange={(checked) => onSelect(item.id, checked === true)}
            className="bg-background/80 backdrop-blur-sm"
          />
        </div>
        {item.favorite && (
          <div className="absolute top-2 right-2 z-10">
            <Heart className="h-4 w-4 fill-red-500 text-red-500" />
          </div>
        )}
        {isProcessing && (
          <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center gap-2">
            <Loader2 className="h-6 w-6 text-white animate-spin" />
            <span className="text-white text-xs font-medium">AI Analyzing...</span>
          </div>
        )}
        {isError && (
          <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center gap-2 p-2">
            <AlertCircle className="h-6 w-6 text-red-400" />
            <span className="text-white text-xs font-medium text-center">Analysis Failed</span>
            {onRetry && (
              <Button
                size="sm"
                variant="secondary"
                className="h-7 text-xs"
                onClick={(e) => {
                  e.stopPropagation();
                  onRetry(item.id);
                }}
              >
                <RefreshCw className="h-3 w-3 mr-1" />
                Retry
              </Button>
            )}
          </div>
        )}
      </div>
      <CardContent className="p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className="font-medium text-sm truncate">
              {item.name || item.type}
            </p>
            <p className="text-xs text-muted-foreground capitalize">
              {item.type}
              {item.subtype && ` • ${item.subtype}`}
            </p>
          </div>
          {colorInfo && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div
                    className="w-4 h-4 rounded-full border shrink-0"
                    style={{ backgroundColor: colorInfo.hex }}
                  />
                </TooltipTrigger>
                <TooltipContent>
                  <p>{colorInfo.name}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
        {item.wear_count > 0 && (
          <p className="text-xs text-muted-foreground mt-1">
            Worn {item.wear_count} time{item.wear_count !== 1 ? 's' : ''}
          </p>
        )}
        {item.ai_confidence !== undefined && item.ai_confidence > 0 && item.status === 'ready' && (
          <p className="text-xs text-muted-foreground mt-1">
            AI confidence: {Math.round(item.ai_confidence * 100)}%
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function ItemCardSkeleton() {
  return (
    <Card className="overflow-hidden">
      <Skeleton className="aspect-square" />
      <CardContent className="p-3">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3 w-1/2 mt-1" />
      </CardContent>
    </Card>
  );
}

function EmptyWardrobe({ onAddClick }: { onAddClick: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
      <div className="rounded-full bg-muted p-6 mb-4">
        <Grid3X3 className="h-12 w-12 text-muted-foreground" />
      </div>
      <h3 className="text-lg font-semibold mb-2">Your wardrowbe is empty</h3>
      <p className="text-muted-foreground mb-6 max-w-sm">
        Add your first clothing item to start getting personalized outfit
        suggestions.
      </p>
      <Button onClick={onAddClick}>
        <Plus className="mr-2 h-4 w-4" />
        Add First Item
      </Button>
    </div>
  );
}

export default function WardrobePage() {
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [selection, setSelection] = useState<BulkSelection>({
    mode: 'none',
    selectedIds: new Set(),
    excludedIds: new Set(),
  });
  const [detailItemId, setDetailItemId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [page, setPage] = useState(1);

  const filters = {
    search: search || undefined,
    type: typeFilter !== 'all' ? typeFilter : undefined,
    is_archived: false,
  };

  // Fetch items with automatic polling (faster when items are processing)
  const { data, isLoading, error } = useItems(filters, page, 20);
  const { data: itemTypes } = useItemTypes();
  const reanalyze = useReanalyzeItem();
  const bulkDelete = useBulkDeleteItems();
  const bulkReanalyze = useBulkReanalyzeItems();

  const items = data?.items || [];
  const total = data?.total || 0;

  // Get selected item from items list for detail dialog
  const detailItem = detailItemId ? items.find((i) => i.id === detailItemId) || null : null;

  // Count items being processed or with errors
  const processingCount = items.filter((i) => i.status === 'processing').length;
  const errorCount = items.filter((i) => i.status === 'error').length;

  // Clear selection when filters change (but not page - allow cross-page selection)
  useEffect(() => {
    setSelection({ mode: 'none', selectedIds: new Set(), excludedIds: new Set() });
  }, [search, typeFilter]);

  const handleRetry = (itemId: string) => {
    reanalyze.mutate(itemId);
  };

  const handleSelect = (id: string, checked: boolean) => {
    setSelection((prev) => {
      if (prev.mode === 'all') {
        // In "select all" mode, toggle exclusion
        const next = new Set(prev.excludedIds);
        if (checked) {
          next.delete(id); // Remove from excluded = selected
        } else {
          next.add(id); // Add to excluded = deselected
        }
        return { ...prev, excludedIds: next };
      } else {
        // In "some" or "none" mode, toggle selection
        const next = new Set(prev.selectedIds);
        if (checked) {
          next.add(id);
        } else {
          next.delete(id);
        }
        return { mode: next.size > 0 ? 'some' : 'none', selectedIds: next, excludedIds: new Set() };
      }
    });
  };

  const handleSelectAll = () => {
    setSelection((prev) => {
      if (prev.mode === 'all' && prev.excludedIds.size === 0) {
        // Already all selected, clear
        return { mode: 'none', selectedIds: new Set(), excludedIds: new Set() };
      } else {
        // Select all
        return { mode: 'all', selectedIds: new Set(), excludedIds: new Set() };
      }
    });
  };

  const handleClearSelection = () => {
    setSelection({ mode: 'none', selectedIds: new Set(), excludedIds: new Set() });
  };

  // Build bulk operation params from selection state
  const getBulkParams = (): BulkOperationParams => {
    if (selection.mode === 'all') {
      return {
        select_all: true,
        excluded_ids: Array.from(selection.excludedIds),
        filters: {
          type: typeFilter !== 'all' ? typeFilter : undefined,
          search: search || undefined,
          is_archived: false,
        },
      };
    } else {
      return {
        item_ids: Array.from(selection.selectedIds),
      };
    }
  };

  const handleBulkDelete = async () => {
    const params = getBulkParams();
    try {
      const result = await bulkDelete.mutateAsync(params);
      toast.success(`Deleted ${result.deleted} items`);
      if (result.failed > 0) {
        toast.error(`Failed to delete ${result.failed} items`);
      }
      handleClearSelection();
    } catch {
      toast.error('Failed to delete items');
    }
  };

  const handleBulkReanalyze = async () => {
    const params = getBulkParams();
    try {
      const result = await bulkReanalyze.mutateAsync(params);
      if (result.queued > 20) {
        toast.success(`Queued ${result.queued} items for re-analysis. This may take a while.`);
      } else {
        toast.success(`Queued ${result.queued} items for re-analysis`);
      }
      if (result.failed > 0) {
        toast.error(`Failed to queue ${result.failed} items`);
      }
      handleClearSelection();
    } catch {
      toast.error('Failed to queue items for re-analysis');
    }
  };

  const handlePageChange = (newPage: number) => {
    setPage(newPage);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center justify-between sm:justify-start gap-3">
            <h1 className="text-2xl font-bold tracking-tight">My Wardrobe</h1>
            <Button onClick={() => setAddDialogOpen(true)} className="sm:hidden" size="sm">
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">
            {total} item{total !== 1 ? 's' : ''} in your wardrobe
          </p>
          {(processingCount > 0 || errorCount > 0) && (
            <div className="flex items-center gap-2 mt-2">
              {processingCount > 0 && (
                <Badge variant="secondary" className="gap-1 text-xs">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  {processingCount} analyzing
                </Badge>
              )}
              {errorCount > 0 && (
                <Badge variant="destructive" className="gap-1 text-xs">
                  <AlertCircle className="h-3 w-3" />
                  {errorCount} failed
                </Badge>
              )}
            </div>
          )}
        </div>
        <Button onClick={() => setAddDialogOpen(true)} className="hidden sm:flex">
          <Plus className="mr-2 h-4 w-4" />
          Add Item
        </Button>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search items..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="pl-9"
          />
        </div>
        <Select
          value={typeFilter}
          onValueChange={(value) => {
            setTypeFilter(value);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-full sm:w-[180px]">
            <SelectValue placeholder="All types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            {CLOTHING_TYPES.map((t) => (
              <SelectItem key={t.value} value={t.value}>
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {error ? (
        <div className="text-center py-8">
          <p className="text-destructive">
            Failed to load items. Please try again.
          </p>
          <Button
            variant="outline"
            className="mt-4"
            onClick={() => window.location.reload()}
          >
            Retry
          </Button>
        </div>
      ) : isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {Array.from({ length: 10 }).map((_, i) => (
            <ItemCardSkeleton key={i} />
          ))}
        </div>
      ) : items.length === 0 ? (
        search || typeFilter !== 'all' ? (
          <div className="text-center py-8">
            <p className="text-muted-foreground">
              No items found matching your filters.
            </p>
            <Button
              variant="outline"
              className="mt-4"
              onClick={() => {
                setSearch('');
                setTypeFilter('all');
              }}
            >
              Clear Filters
            </Button>
          </div>
        ) : (
          <EmptyWardrobe onAddClick={() => setAddDialogOpen(true)} />
        )
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 pb-20">
          {items.map((item) => {
            // Determine if item is selected based on selection mode
            const isSelected = selection.mode === 'all'
              ? !selection.excludedIds.has(item.id)
              : selection.selectedIds.has(item.id);
            return (
              <ItemCard
                key={item.id}
                item={item}
                selected={isSelected}
                onSelect={handleSelect}
                onRetry={handleRetry}
                onClick={() => setDetailItemId(item.id)}
              />
            );
          })}
        </div>
      )}

      <BulkActionToolbar
        selection={selection}
        totalItems={total}
        pageItems={items.length}
        onSelectAll={handleSelectAll}
        onClear={handleClearSelection}
        onDelete={handleBulkDelete}
        onReanalyze={handleBulkReanalyze}
        isDeleting={bulkDelete.isPending}
        isReanalyzing={bulkReanalyze.isPending}
        page={page}
        pageSize={20}
        onPageChange={handlePageChange}
      />

      <AddItemDialog open={addDialogOpen} onOpenChange={setAddDialogOpen} />
      <ItemDetailDialog
        item={detailItem}
        open={!!detailItem}
        onOpenChange={(open) => !open && setDetailItemId(null)}
      />
    </div>
  );
}
