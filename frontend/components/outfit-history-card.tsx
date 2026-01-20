'use client';

import { Calendar, Zap, Edit3, ThumbsUp, ThumbsDown, Clock, Eye, Star } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { useAcceptOutfit, useRejectOutfit, type Outfit, type OutfitSource } from '@/lib/hooks/use-outfits';
import Image from 'next/image';

function StatusIcon({ status }: { status: Outfit['status'] }) {
  switch (status) {
    case 'accepted':
      return <ThumbsUp className="h-4 w-4 text-green-500" />;
    case 'rejected':
      return <ThumbsDown className="h-4 w-4 text-red-500" />;
    case 'viewed':
      return <Eye className="h-4 w-4 text-blue-500" />;
    case 'sent':
    case 'pending':
      return <Clock className="h-4 w-4 text-muted-foreground" />;
    case 'expired':
      return <Clock className="h-4 w-4 text-orange-500" />;
    default:
      return <Clock className="h-4 w-4 text-muted-foreground" />;
  }
}

function StatusBadge({ status }: { status: Outfit['status'] }) {
  const variants: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
    accepted: 'default',
    rejected: 'destructive',
    viewed: 'secondary',
    sent: 'outline',
    pending: 'outline',
    expired: 'secondary',
  };

  return (
    <Badge variant={variants[status] || 'outline'} className="capitalize">
      {status}
    </Badge>
  );
}

function SourceBadge({ source }: { source: OutfitSource }) {
  const config: Record<OutfitSource, { icon: typeof Calendar; label: string; className: string }> = {
    scheduled: {
      icon: Calendar,
      label: 'Scheduled',
      className: 'bg-primary/10 text-primary border-primary/20',
    },
    on_demand: {
      icon: Zap,
      label: 'On Demand',
      className: 'bg-orange-500/10 text-orange-600 border-orange-500/20',
    },
    manual: {
      icon: Edit3,
      label: 'Manual',
      className: 'bg-purple-500/10 text-purple-600 border-purple-500/20',
    },
    pairing: {
      icon: Zap,
      label: 'Pairing',
      className: 'bg-violet-500/10 text-violet-600 border-violet-500/20',
    },
  };

  const { icon: Icon, label, className } = config[source];

  return (
    <Badge variant="outline" className={className}>
      <Icon className="h-3 w-3 mr-1" />
      {label}
    </Badge>
  );
}

function StarRating({ rating, size = 'sm' }: { rating: number; size?: 'sm' | 'lg' }) {
  const sizeClass = size === 'lg' ? 'h-5 w-5' : 'h-3.5 w-3.5';

  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((star) => (
        <Star
          key={star}
          className={`${sizeClass} ${star <= rating ? 'fill-yellow-400 text-yellow-400' : 'text-muted-foreground/30'}`}
        />
      ))}
    </div>
  );
}

interface OutfitHistoryCardProps {
  outfit: Outfit;
  onFeedback: () => void;
  onPreview?: () => void;
}

export function OutfitHistoryCard({ outfit, onFeedback, onPreview }: OutfitHistoryCardProps) {
  const acceptOutfit = useAcceptOutfit();
  const rejectOutfit = useRejectOutfit();

  const handleAccept = async () => {
    try {
      await acceptOutfit.mutateAsync(outfit.id);
      toast.success('Outfit accepted');
    } catch {
      toast.error('Failed to accept outfit');
    }
  };

  const handleReject = async () => {
    try {
      await rejectOutfit.mutateAsync(outfit.id);
      toast.success('Outfit rejected');
    } catch {
      toast.error('Failed to reject outfit');
    }
  };

  const isPending = outfit.status === 'pending' || outfit.status === 'sent' || outfit.status === 'viewed';

  return (
    <Card className="overflow-hidden h-full flex flex-col">
      <CardContent className="p-3 flex flex-col flex-1">
        {/* Header with source badge and status */}
        <div className="flex items-center justify-between mb-2">
          <SourceBadge source={outfit.source} />
          <div className="flex items-center gap-1.5">
            <Badge variant="secondary" className="capitalize text-xs">
              {outfit.occasion}
            </Badge>
            <StatusIcon status={outfit.status} />
          </div>
        </div>

        {/* Item thumbnails - clickable to preview */}
        <button
          type="button"
          onClick={onPreview}
          className="flex gap-2 text-left w-full group"
        >
          {outfit.items.map((item) => (
            <div
              key={item.id}
              className="w-16 h-16 rounded-lg bg-muted overflow-hidden relative border shadow-sm group-hover:shadow-md transition-shadow"
            >
              {item.thumbnail_path ? (
                <Image
                  src={`/api/v1/images/${item.thumbnail_path}`}
                  alt={item.name || item.type}
                  fill
                  className="object-cover"
                  sizes="64px"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-xs text-muted-foreground">
                  {item.type}
                </div>
              )}
            </div>
          ))}
        </button>

        {/* Inline feedback display */}
        {outfit.feedback && (outfit.feedback.rating || outfit.feedback.comment) && (
          <div className="mt-2 pt-2 border-t">
            <div className="flex items-center gap-2">
              {outfit.feedback.rating && (
                <StarRating rating={outfit.feedback.rating} />
              )}
              {outfit.feedback.comment && (
                <p className="text-xs text-muted-foreground truncate flex-1">
                  &ldquo;{outfit.feedback.comment}&rdquo;
                </p>
              )}
            </div>
          </div>
        )}

        {/* Details section */}
        {(outfit.reasoning || outfit.style_notes || (outfit.highlights && outfit.highlights.length > 0)) && (
          <div className="mt-2 space-y-2 text-xs flex-1">
            {outfit.reasoning && (
              <p className="font-medium text-foreground">{outfit.reasoning}</p>
            )}
            {outfit.highlights && outfit.highlights.length > 0 && (
              <ul className="space-y-0.5">
                {outfit.highlights.map((highlight, index) => (
                  <li key={index} className="flex items-start gap-1.5 text-muted-foreground">
                    <span className="text-primary mt-0.5">•</span>
                    <span>{highlight}</span>
                  </li>
                ))}
              </ul>
            )}
            {outfit.style_notes && (
              <div className="p-2 bg-muted rounded border">
                <p className="text-muted-foreground">
                  <span className="font-medium text-foreground">Tip:</span> {outfit.style_notes}
                </p>
              </div>
            )}
          </div>
        )}

        {/* Action buttons - pushed to bottom */}
        <div className="mt-auto pt-3">
          {isPending && (
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                className="flex-1 h-8 text-xs"
                onClick={handleReject}
                disabled={rejectOutfit.isPending}
              >
                <ThumbsDown className="h-3 w-3 mr-1" />
                Reject
              </Button>
              <Button
                size="sm"
                className="flex-1 h-8 text-xs"
                onClick={handleAccept}
                disabled={acceptOutfit.isPending}
              >
                <ThumbsUp className="h-3 w-3 mr-1" />
                Accept
              </Button>
            </div>
          )}

          {outfit.status === 'accepted' && (
            <Button
              size="sm"
              variant="outline"
              className="w-full h-8 text-xs"
              onClick={onFeedback}
            >
              <Star className="h-3 w-3 mr-1" />
              {outfit.feedback?.rating ? 'Update' : 'Rate'}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
