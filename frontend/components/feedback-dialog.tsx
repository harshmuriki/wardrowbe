'use client';

import { useState, useEffect } from 'react';
import { Star } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { useSubmitFeedback, type Outfit } from '@/lib/hooks/use-outfits';

function StarRating({
  rating,
  onRate,
  size = 'sm',
}: {
  rating: number;
  onRate?: (rating: number) => void;
  size?: 'sm' | 'lg';
}) {
  const sizeClass = size === 'lg' ? 'h-6 w-6' : 'h-4 w-4';

  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          onClick={() => onRate?.(star)}
          disabled={!onRate}
          className={onRate ? 'cursor-pointer hover:scale-110 transition-transform' : 'cursor-default'}
        >
          <Star
            className={`${sizeClass} ${star <= rating ? 'fill-yellow-400 text-yellow-400' : 'text-muted-foreground'}`}
          />
        </button>
      ))}
    </div>
  );
}

interface FeedbackDialogProps {
  outfit: Outfit;
  open: boolean;
  onClose: () => void;
}

export function FeedbackDialog({ outfit, open, onClose }: FeedbackDialogProps) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [markAsWorn, setMarkAsWorn] = useState(true);
  const submitFeedback = useSubmitFeedback();

  // Reset state when dialog opens for a different outfit
  useEffect(() => {
    if (open) {
      // Pre-fill with existing feedback if available
      setRating(outfit.feedback?.rating ?? 0);
      setComment(outfit.feedback?.comment ?? '');
      setMarkAsWorn(!outfit.feedback?.worn_at);
    }
  }, [open, outfit.id, outfit.feedback]);

  const handleSubmit = async () => {
    try {
      await submitFeedback.mutateAsync({
        outfitId: outfit.id,
        feedback: {
          rating: rating > 0 ? rating : undefined,
          comment: comment.trim() || undefined,
          worn: markAsWorn || undefined,
        },
      });
      toast.success('Feedback submitted');
      onClose();
    } catch {
      toast.error('Failed to submit feedback');
    }
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rate This Outfit</DialogTitle>
          <DialogDescription>
            How did this outfit work out for you?
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div>
            <label className="text-sm font-medium mb-2 block">Overall Rating</label>
            <StarRating rating={rating} onRate={setRating} size="lg" />
          </div>
          <div>
            <label className="text-sm font-medium mb-2 block">Comments (optional)</label>
            <Textarea
              placeholder="Any thoughts about this outfit?"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
          </div>
          {!outfit.feedback?.worn_at && (
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={markAsWorn}
                onChange={(e) => setMarkAsWorn(e.target.checked)}
                className="rounded border-input"
              />
              <span className="text-sm">Mark as worn today</span>
            </label>
          )}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitFeedback.isPending}>
            {submitFeedback.isPending ? 'Submitting...' : 'Submit'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
