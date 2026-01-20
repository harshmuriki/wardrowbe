'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { Loader2, Save, RotateCcw, Check, Plus, Trash2, ChevronUp, ChevronDown, Server, MapPin, Navigation } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { usePreferences, useUpdatePreferences, useResetPreferences, useTestAIEndpoint } from '@/lib/hooks/use-preferences';
import { useUserProfile, useUpdateUserProfile } from '@/lib/hooks/use-user';
import { CLOTHING_COLORS, OCCASIONS, Preferences, StyleProfile, AIEndpoint } from '@/lib/types';
import { toast } from 'sonner';

interface EndpointTestResult {
  status: 'connected' | 'error' | 'testing' | null;
  models?: string[];
  visionModels?: string[];
  textModels?: string[];
  error?: string;
}

function ColorPicker({
  selected,
  onChange,
  label,
}: {
  selected: string[];
  onChange: (colors: string[]) => void;
  label: string;
}) {
  const toggleColor = (color: string) => {
    if (selected.includes(color)) {
      onChange(selected.filter((c) => c !== color));
    } else {
      onChange([...selected, color]);
    }
  };

  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div className="flex flex-wrap gap-2">
        {CLOTHING_COLORS.map((color) => {
          const isSelected = selected.includes(color.value);
          return (
            <button
              key={color.value}
              type="button"
              onClick={() => toggleColor(color.value)}
              className={`w-8 h-8 rounded-full border-2 transition-all ${
                isSelected
                  ? 'border-primary ring-2 ring-primary/30 scale-110'
                  : 'border-muted-foreground/20 hover:border-muted-foreground/40'
              }`}
              style={{ backgroundColor: color.hex }}
              title={color.name}
            >
              {isSelected && (
                <Check
                  className={`h-4 w-4 mx-auto ${
                    color.value === 'white' || color.value === 'yellow' || color.value === 'beige'
                      ? 'text-black'
                      : 'text-white'
                  }`}
                />
              )}
            </button>
          );
        })}
      </div>
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {selected.map((color) => {
            const colorInfo = CLOTHING_COLORS.find((c) => c.value === color);
            return (
              <Badge key={color} variant="secondary" className="gap-1">
                <div
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: colorInfo?.hex }}
                />
                {colorInfo?.name}
              </Badge>
            );
          })}
        </div>
      )}
    </div>
  );
}

function StyleSlider({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex justify-between items-center">
        <Label>{label}</Label>
        <span className="text-sm text-muted-foreground">{value}%</span>
      </div>
      <Slider
        value={[value]}
        onValueChange={(vals) => onChange(vals[0])}
        min={0}
        max={100}
        step={10}
      />
    </div>
  );
}

export default function SettingsPage() {
  const { data: session } = useSession();
  const { data: preferences, isLoading } = usePreferences();
  const { data: userProfile, isLoading: isLoadingProfile } = useUserProfile();
  const updatePreferences = useUpdatePreferences();
  const resetPreferences = useResetPreferences();
  const testEndpoint = useTestAIEndpoint();
  const updateUserProfile = useUpdateUserProfile();

  const [formData, setFormData] = useState<Partial<Preferences>>({});
  const [hasChanges, setHasChanges] = useState(false);
  const [endpointTests, setEndpointTests] = useState<Record<number, EndpointTestResult>>({});

  // Location and timezone state
  const [locationName, setLocationName] = useState('');
  const [locationLat, setLocationLat] = useState('');
  const [locationLon, setLocationLon] = useState('');
  const [timezone, setTimezone] = useState('UTC');
  const [isGettingLocation, setIsGettingLocation] = useState(false);

  // Initialize location and timezone from profile
  useEffect(() => {
    if (userProfile) {
      setLocationName(userProfile.location_name || '');
      setLocationLat(userProfile.location_lat?.toString() || '');
      setLocationLon(userProfile.location_lon?.toString() || '');
      setTimezone(userProfile.timezone || 'UTC');
    }
  }, [userProfile]);

  const handleGetCurrentLocation = () => {
    if (!navigator.geolocation) {
      toast.error('Geolocation is not supported by your browser');
      return;
    }

    setIsGettingLocation(true);
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const lat = position.coords.latitude.toFixed(6);
        const lon = position.coords.longitude.toFixed(6);
        setLocationLat(lat);
        setLocationLon(lon);

        // Reverse geocode to get city name
        try {
          const response = await fetch(
            `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`,
            { headers: { 'User-Agent': 'WardrobeAI/1.0' } }
          );
          if (response.ok) {
            const data = await response.json();
            const city = data.address?.city || data.address?.town || data.address?.village || data.address?.municipality;
            const country = data.address?.country;
            if (city && country) {
              setLocationName(`${city}, ${country}`);
            } else if (city) {
              setLocationName(city);
            } else if (data.display_name) {
              // Fallback to first part of display name
              setLocationName(data.display_name.split(',').slice(0, 2).join(',').trim());
            }
          }
        } catch {
          // Ignore geocoding errors, we still have coordinates
        }

        setIsGettingLocation(false);
        toast.success('Location detected');
      },
      (error) => {
        setIsGettingLocation(false);
        toast.error(`Failed to get location: ${error.message}`);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const handleSaveLocation = async () => {
    const lat = parseFloat(locationLat);
    const lon = parseFloat(locationLon);

    if (isNaN(lat) || isNaN(lon)) {
      toast.error('Please enter valid latitude and longitude values');
      return;
    }

    if (lat < -90 || lat > 90) {
      toast.error('Latitude must be between -90 and 90');
      return;
    }

    if (lon < -180 || lon > 180) {
      toast.error('Longitude must be between -180 and 180');
      return;
    }

    try {
      await updateUserProfile.mutateAsync({
        location_lat: lat,
        location_lon: lon,
        location_name: locationName || undefined,
        timezone: timezone,
      });
      toast.success('Location and timezone saved');
    } catch {
      toast.error('Failed to save location');
    }
  };

  const hasLocationChanges = userProfile && (
    locationName !== (userProfile.location_name || '') ||
    locationLat !== (userProfile.location_lat?.toString() || '') ||
    locationLon !== (userProfile.location_lon?.toString() || '') ||
    timezone !== (userProfile.timezone || 'UTC')
  );

  const handleTestEndpoint = async (index: number, url: string) => {
    setEndpointTests((prev) => ({ ...prev, [index]: { status: 'testing' } }));
    try {
      const result = await testEndpoint.mutateAsync(url);
      setEndpointTests((prev) => ({
        ...prev,
        [index]: {
          status: result.status,
          models: result.available_models,
          visionModels: result.vision_models,
          textModels: result.text_models,
          error: result.error,
        },
      }));
    } catch (error) {
      setEndpointTests((prev) => ({
        ...prev,
        [index]: { status: 'error', error: 'Failed to test endpoint' },
      }));
    }
  };

  useEffect(() => {
    if (preferences) {
      setFormData(preferences);
      setHasChanges(false);
    }
  }, [preferences]);

  const updateField = <K extends keyof Preferences>(key: K, value: Preferences[K]) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
    setHasChanges(true);
  };

  const updateStyleProfile = (key: keyof StyleProfile, value: number) => {
    setFormData((prev) => ({
      ...prev,
      style_profile: {
        ...(prev.style_profile || {
          casual: 50,
          formal: 50,
          sporty: 50,
          minimalist: 50,
          bold: 50,
        }),
        [key]: value,
      },
    }));
    setHasChanges(true);
  };

  const handleSave = async () => {
    try {
      await updatePreferences.mutateAsync(formData);
      setHasChanges(false);
    } catch (error) {
      console.error('Failed to save preferences:', error);
    }
  };

  const handleReset = async () => {
    if (confirm('Reset all preferences to defaults?')) {
      try {
        await resetPreferences.mutateAsync();
      } catch (error) {
        console.error('Failed to reset preferences:', error);
      }
    }
  };

  if (isLoading || isLoadingProfile) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
          <p className="text-sm text-muted-foreground">
            Manage your preferences and account settings
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleReset} disabled={resetPreferences.isPending}>
            <RotateCcw className="mr-2 h-4 w-4" />
            Reset
          </Button>
          <Button size="sm" onClick={handleSave} disabled={!hasChanges || updatePreferences.isPending}>
            {updatePreferences.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-2 h-4 w-4" />
            )}
            Save
          </Button>
        </div>
      </div>

      <div className="grid gap-6">
        {/* Account Section */}
        <Card>
          <CardHeader>
            <CardTitle>Account</CardTitle>
            <CardDescription>Your profile information</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Name</Label>
                <Input value={userProfile?.display_name || ''} disabled />
              </div>
              <div className="space-y-2">
                <Label>Email</Label>
                <Input value={userProfile?.email || ''} disabled />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Location Section */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MapPin className="h-5 w-5" />
              Location
            </CardTitle>
            <CardDescription>
              Set your location for weather-based outfit recommendations
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>City / Location Name (optional)</Label>
              <Input
                value={locationName}
                onChange={(e) => setLocationName(e.target.value)}
                placeholder="e.g., London, UK"
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Latitude</Label>
                <Input
                  type="number"
                  step="0.000001"
                  value={locationLat}
                  onChange={(e) => setLocationLat(e.target.value)}
                  placeholder="e.g., 51.5074"
                />
              </div>
              <div className="space-y-2">
                <Label>Longitude</Label>
                <Input
                  type="number"
                  step="0.000001"
                  value={locationLon}
                  onChange={(e) => setLocationLon(e.target.value)}
                  placeholder="e.g., -0.1278"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Timezone</Label>
              <Select value={timezone} onValueChange={setTimezone}>
                <SelectTrigger>
                  <SelectValue placeholder="Select timezone" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="UTC">UTC</SelectItem>
                  <SelectItem value="America/New_York">Eastern Time (US)</SelectItem>
                  <SelectItem value="America/Chicago">Central Time (US)</SelectItem>
                  <SelectItem value="America/Denver">Mountain Time (US)</SelectItem>
                  <SelectItem value="America/Los_Angeles">Pacific Time (US)</SelectItem>
                  <SelectItem value="Europe/London">London (UK)</SelectItem>
                  <SelectItem value="Europe/Paris">Paris (EU Central)</SelectItem>
                  <SelectItem value="Europe/Berlin">Berlin (EU Central)</SelectItem>
                  <SelectItem value="Asia/Tokyo">Tokyo (Japan)</SelectItem>
                  <SelectItem value="Asia/Shanghai">Shanghai (China)</SelectItem>
                  <SelectItem value="Asia/Kolkata">India (IST)</SelectItem>
                  <SelectItem value="Asia/Kathmandu">Nepal (NPT)</SelectItem>
                  <SelectItem value="Asia/Dubai">Dubai (UAE)</SelectItem>
                  <SelectItem value="Australia/Sydney">Sydney (Australia)</SelectItem>
                  <SelectItem value="Pacific/Auckland">Auckland (NZ)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={handleGetCurrentLocation}
                disabled={isGettingLocation}
              >
                {isGettingLocation ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Navigation className="h-4 w-4 mr-2" />
                )}
                Use My Location
              </Button>
              <Button
                onClick={handleSaveLocation}
                disabled={!hasLocationChanges || updateUserProfile.isPending}
              >
                {updateUserProfile.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Save className="h-4 w-4 mr-2" />
                )}
                Save Location
              </Button>
            </div>
            {!locationLat && !locationLon && (
              <p className="text-sm text-amber-600 dark:text-amber-400">
                Location is required for weather-based outfit recommendations.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Color Preferences */}
        <Card>
          <CardHeader>
            <CardTitle>Color Preferences</CardTitle>
            <CardDescription>
              Select colors you love and colors to avoid in recommendations
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <ColorPicker
              label="Favorite Colors"
              selected={formData.color_favorites || []}
              onChange={(colors) => updateField('color_favorites', colors)}
            />
            <ColorPicker
              label="Colors to Avoid"
              selected={formData.color_avoid || []}
              onChange={(colors) => updateField('color_avoid', colors)}
            />
          </CardContent>
        </Card>

        {/* Style Profile */}
        <Card>
          <CardHeader>
            <CardTitle>Style Profile</CardTitle>
            <CardDescription>
              Adjust how much you prefer each style in outfit recommendations
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <StyleSlider
              label="Casual"
              value={formData.style_profile?.casual ?? 50}
              onChange={(v) => updateStyleProfile('casual', v)}
            />
            <StyleSlider
              label="Formal"
              value={formData.style_profile?.formal ?? 50}
              onChange={(v) => updateStyleProfile('formal', v)}
            />
            <StyleSlider
              label="Sporty"
              value={formData.style_profile?.sporty ?? 50}
              onChange={(v) => updateStyleProfile('sporty', v)}
            />
            <StyleSlider
              label="Minimalist"
              value={formData.style_profile?.minimalist ?? 50}
              onChange={(v) => updateStyleProfile('minimalist', v)}
            />
            <StyleSlider
              label="Bold"
              value={formData.style_profile?.bold ?? 50}
              onChange={(v) => updateStyleProfile('bold', v)}
            />
          </CardContent>
        </Card>

        {/* Temperature & Comfort */}
        <Card>
          <CardHeader>
            <CardTitle>Temperature & Comfort</CardTitle>
            <CardDescription>
              Adjust how recommendations adapt to weather
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Temperature Sensitivity</Label>
                <Select
                  value={formData.temperature_sensitivity || 'normal'}
                  onValueChange={(v) =>
                    updateField('temperature_sensitivity', v as 'low' | 'normal' | 'high')
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">I feel warm easily</SelectItem>
                    <SelectItem value="normal">Normal</SelectItem>
                    <SelectItem value="high">I feel cold easily</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Layering Preference</Label>
                <Select
                  value={formData.layering_preference || 'moderate'}
                  onValueChange={(v) =>
                    updateField('layering_preference', v as 'minimal' | 'moderate' | 'heavy')
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="minimal">Minimal layers</SelectItem>
                    <SelectItem value="moderate">Moderate layers</SelectItem>
                    <SelectItem value="heavy">Heavy layers</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Cold Threshold (°C)</Label>
                <Input
                  type="number"
                  value={formData.cold_threshold ?? 10}
                  onChange={(e) => updateField('cold_threshold', e.target.value === '' ? 10 : parseInt(e.target.value))}
                  min={-20}
                  max={30}
                />
              </div>
              <div className="space-y-2">
                <Label>Hot Threshold (°C)</Label>
                <Input
                  type="number"
                  value={formData.hot_threshold ?? 25}
                  onChange={(e) => updateField('hot_threshold', e.target.value === '' ? 25 : parseInt(e.target.value))}
                  min={10}
                  max={45}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Recommendation Settings */}
        <Card>
          <CardHeader>
            <CardTitle>Recommendation Settings</CardTitle>
            <CardDescription>
              Customize how outfit recommendations are generated
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Default Occasion</Label>
                <Select
                  value={formData.default_occasion || 'casual'}
                  onValueChange={(v) => updateField('default_occasion', v)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {OCCASIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Variety Level</Label>
                <Select
                  value={formData.variety_level || 'moderate'}
                  onValueChange={(v) =>
                    updateField('variety_level', v as 'low' | 'moderate' | 'high')
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low (stick to favorites)</SelectItem>
                    <SelectItem value="moderate">Moderate</SelectItem>
                    <SelectItem value="high">High (try new combinations)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Avoid Repeat Items Within (days)</Label>
                <Input
                  type="number"
                  value={formData.avoid_repeat_days ?? 7}
                  onChange={(e) => updateField('avoid_repeat_days', e.target.value === '' ? 7 : parseInt(e.target.value))}
                  min={0}
                  max={30}
                />
              </div>
              <div className="space-y-2">
                <Label>Prefer Underused Items</Label>
                <Select
                  value={formData.prefer_underused_items ? 'yes' : 'no'}
                  onValueChange={(v) => updateField('prefer_underused_items', v === 'yes')}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="yes">Yes</SelectItem>
                    <SelectItem value="no">No</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* AI Endpoints */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Server className="h-5 w-5" />
              AI Endpoints
            </CardTitle>
            <CardDescription>
              Configure AI endpoints for image analysis. Endpoints are tried in order from top to bottom.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {(formData.ai_endpoints || []).length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No custom endpoints configured. Using default server settings.
              </p>
            ) : (
              <div className="space-y-3">
                {(formData.ai_endpoints || []).map((endpoint, index) => (
                  <div
                    key={index}
                    className={`border rounded-lg p-4 space-y-3 ${
                      !endpoint.enabled ? 'opacity-60 bg-muted/50' : ''
                    }`}
                  >
                    <div className="space-y-2">
                      {/* Header row */}
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="flex flex-col shrink-0">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-5 w-5 p-0"
                              disabled={index === 0}
                              onClick={() => {
                                const updated = [...(formData.ai_endpoints || [])];
                                [updated[index - 1], updated[index]] = [updated[index], updated[index - 1]];
                                updateField('ai_endpoints', updated);
                              }}
                            >
                              <ChevronUp className="h-3 w-3" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-5 w-5 p-0"
                              disabled={index === (formData.ai_endpoints || []).length - 1}
                              onClick={() => {
                                const updated = [...(formData.ai_endpoints || [])];
                                [updated[index], updated[index + 1]] = [updated[index + 1], updated[index]];
                                updateField('ai_endpoints', updated);
                              }}
                            >
                              <ChevronDown className="h-3 w-3" />
                            </Button>
                          </div>
                          <span className="font-medium text-sm truncate">
                            {endpoint.name || `Endpoint ${index + 1}`}
                          </span>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <Switch
                            checked={endpoint.enabled}
                            onCheckedChange={(checked) => {
                              const updated = [...(formData.ai_endpoints || [])];
                              updated[index] = { ...updated[index], enabled: checked };
                              updateField('ai_endpoints', updated);
                            }}
                          />
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-destructive"
                            onClick={() => {
                              const updated = (formData.ai_endpoints || []).filter((_, i) => i !== index);
                              updateField('ai_endpoints', updated);
                              setEndpointTests((prev) => {
                                const newTests = { ...prev };
                                delete newTests[index];
                                return newTests;
                              });
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                      {/* Status badges and test button */}
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant={endpoint.enabled ? 'default' : 'secondary'} className="text-xs">
                          {endpoint.enabled ? 'Active' : 'Disabled'}
                        </Badge>
                        {endpointTests[index]?.status === 'connected' && (
                          <Badge variant="outline" className="text-xs text-green-600 border-green-600">
                            Connected
                          </Badge>
                        )}
                        {endpointTests[index]?.status === 'error' && (
                          <Badge variant="outline" className="text-xs text-red-600 border-red-600">
                            Error
                          </Badge>
                        )}
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-6 text-xs ml-auto"
                          onClick={() => handleTestEndpoint(index, endpoint.url)}
                          disabled={endpointTests[index]?.status === 'testing' || !endpoint.url}
                        >
                          {endpointTests[index]?.status === 'testing' ? (
                            <Loader2 className="h-3 w-3 animate-spin mr-1" />
                          ) : null}
                          Test Connection
                        </Button>
                      </div>
                    </div>
                    {/* Test Results */}
                    {endpointTests[index]?.status === 'connected' && endpointTests[index]?.models && (
                      <div className="text-xs space-y-1 p-2 bg-green-50 dark:bg-green-950 rounded overflow-hidden">
                        <p className="font-medium text-green-700 dark:text-green-300">
                          {endpointTests[index].models?.length} models available
                        </p>
                        {endpointTests[index].visionModels && endpointTests[index].visionModels!.length > 0 && (
                          <p className="text-green-600 dark:text-green-400 truncate" title={endpointTests[index].visionModels?.join(', ')}>
                            Vision: {endpointTests[index].visionModels?.slice(0, 3).join(', ')}
                            {(endpointTests[index].visionModels?.length || 0) > 3 && '...'}
                          </p>
                        )}
                        {endpointTests[index].textModels && endpointTests[index].textModels!.length > 0 && (
                          <p className="text-green-600 dark:text-green-400 truncate" title={endpointTests[index].textModels?.join(', ')}>
                            Text: {endpointTests[index].textModels?.slice(0, 3).join(', ')}
                            {(endpointTests[index].textModels?.length || 0) > 3 && '...'}
                          </p>
                        )}
                      </div>
                    )}
                    {endpointTests[index]?.status === 'error' && (
                      <div className="text-xs p-2 bg-red-50 dark:bg-red-950 rounded text-red-600 dark:text-red-400 break-words">
                        {endpointTests[index].error}
                      </div>
                    )}
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1">
                        <Label className="text-xs">Name</Label>
                        <Input
                          value={endpoint.name}
                          onChange={(e) => {
                            const updated = [...(formData.ai_endpoints || [])];
                            updated[index] = { ...updated[index], name: e.target.value };
                            updateField('ai_endpoints', updated);
                          }}
                          placeholder="e.g., Local Ollama"
                          className="h-8"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">URL</Label>
                        <Input
                          value={endpoint.url}
                          onChange={(e) => {
                            const updated = [...(formData.ai_endpoints || [])];
                            updated[index] = { ...updated[index], url: e.target.value };
                            updateField('ai_endpoints', updated);
                          }}
                          placeholder="http://localhost:11434/v1"
                          className="h-8"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Vision Model</Label>
                        <Input
                          value={endpoint.vision_model}
                          onChange={(e) => {
                            const updated = [...(formData.ai_endpoints || [])];
                            updated[index] = { ...updated[index], vision_model: e.target.value };
                            updateField('ai_endpoints', updated);
                          }}
                          placeholder="moondream"
                          className="h-8"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Text Model</Label>
                        <Input
                          value={endpoint.text_model}
                          onChange={(e) => {
                            const updated = [...(formData.ai_endpoints || [])];
                            updated[index] = { ...updated[index], text_model: e.target.value };
                            updateField('ai_endpoints', updated);
                          }}
                          placeholder="phi3:mini"
                          className="h-8"
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => {
                  const newEndpoint: AIEndpoint = {
                    name: `Endpoint ${(formData.ai_endpoints || []).length + 1}`,
                    url: 'http://localhost:11434/v1',
                    vision_model: 'moondream',
                    text_model: 'phi3:mini',
                    enabled: true,
                  };
                  updateField('ai_endpoints', [...(formData.ai_endpoints || []), newEndpoint]);
                }}
              >
                <Plus className="h-4 w-4 mr-2" />
                Add Endpoint
              </Button>
              {hasChanges && (
                <Button onClick={handleSave} disabled={updatePreferences.isPending}>
                  {updatePreferences.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <Save className="h-4 w-4 mr-2" />
                  )}
                  Save
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
