import React from 'react';
import {
  Home, LayoutDashboard, CalendarClock, Users, Network, Target, ClipboardCheck, Palmtree,
  FileClock, Clock, CalendarDays, Wallet, Sliders, Fingerprint, Settings2, ShieldCheck,
  Sparkles, Megaphone, Cake, CircleUser, FileText, UserPlus, KeyRound, MailPlus,
  UserMinus, Database, CheckCircle2, Search, Power, Settings, Grid3x3, Send,
  Plus, X, ChevronLeft, ChevronRight, ArrowUpRight, GripVertical, Trash2, Maximize2,
  BarChart3, ListChecks, StickyNote, Link2, Gauge, Wand2, PieChart, TrendingUp,
  Bell, Package, ChevronDown, LogOut, Pin, RefreshCw, Inbox, PartyPopper,
  Eye, EyeOff, LayoutGrid, AlertTriangle, Lock, Unlock, Pencil, MessageCircle,
  Save, Ban, Copy, Download, Filter, CalendarX, UserCheck, Building2,
  Activity, AlarmClock, BadgeCheck, BellRing, CheckCheck, CircleCheck, CircleDot, Clock3,
  Hourglass, Info, LogIn, MapPin, PenLine, SendHorizontal, TriangleAlert, UserRoundCheck,
  UserX, Mail, MessageSquare, Smartphone, PlugZap, Plug, Bot, Languages,
  Gift, Award, Heart, Loader2, ExternalLink, History, Radio, Workflow,
  Zap, CircleX, Phone, AtSign, Rocket, ListFilter, Star, RotateCcw,
  Undo2, Building, Factory, Briefcase, HeartHandshake, CircleAlert, ArrowRight, ScrollText,
  Siren, TestTube2, KeySquare, Coffee, Sun, Moon, Sunrise, Sunset,
  Timer, CalendarCheck, CalendarRange, Users2, MonitorSmartphone, Lightbulb, ShieldAlert, FileSpreadsheet,
  Sparkle, ChevronUp, Play, Square, Server, Webhook, Globe, Clipboard,
  ClipboardList, MessageCircleHeart, Trophy, Hand, Flame, Banknote, Receipt, FileCheck2,
  Scale, Calculator, UserRound, ClipboardPaste,
  Menu, CornerDownLeft, CalendarCheck2, CircleHelp, ArrowLeft, MoreHorizontal, PanelLeft,
  Wifi, WifiOff, Cloud, Monitor, Router, Check,
} from 'lucide-react';

const MAP = {
  Home, LayoutDashboard, CalendarClock, Users, Network, Target, ClipboardCheck, Palmtree,
  FileClock, Clock, CalendarDays, Wallet, Sliders, Fingerprint, Settings2, ShieldCheck,
  Sparkles, Megaphone, Cake, CircleUser, FileText, UserPlus, KeyRound, MailPlus,
  UserMinus, Database, CheckCircle2, Search, Power, Settings, Grid3x3, Send,
  Plus, X, ChevronLeft, ChevronRight, ArrowUpRight, GripVertical, Trash2, Maximize2,
  BarChart3, ListChecks, StickyNote, Link2, Gauge, Wand2, PieChart, TrendingUp,
  Bell, Package, ChevronDown, LogOut, Pin, RefreshCw, Inbox, PartyPopper,
  Eye, EyeOff, LayoutGrid, AlertTriangle, Lock, Unlock, Pencil, MessageCircle,
  Save, Ban, Copy, Download, Filter, CalendarX, UserCheck, Building2,
  Activity, AlarmClock, BadgeCheck, BellRing, CheckCheck, CircleCheck, CircleDot, Clock3,
  Hourglass, Info, LogIn, MapPin, PenLine, SendHorizontal, TriangleAlert, UserRoundCheck,
  UserX, Mail, MessageSquare, Smartphone, PlugZap, Plug, Bot, Languages,
  Gift, Award, Heart, Loader2, ExternalLink, History, Radio, Workflow,
  Zap, CircleX, Phone, AtSign, Rocket, ListFilter, Star, RotateCcw,
  Undo2, Building, Factory, Briefcase, HeartHandshake, CircleAlert, ArrowRight, ScrollText,
  Siren, TestTube2, KeySquare, Coffee, Sun, Moon, Sunrise, Sunset,
  Timer, CalendarCheck, CalendarRange, Users2, MonitorSmartphone, Lightbulb, ShieldAlert, FileSpreadsheet,
  Sparkle, ChevronUp, Play, Square, Server, Webhook, Globe, Clipboard,
  ClipboardList, MessageCircleHeart, Trophy, Hand, Flame, Banknote, Receipt, FileCheck2,
  Scale, Calculator, UserRound, ClipboardPaste, Menu, CornerDownLeft, CalendarCheck2, CircleHelp, ArrowLeft, MoreHorizontal, PanelLeft,
  Wifi, WifiOff, Cloud, Monitor, Router, Check,
};

export default function Icon({ name, size = 18, strokeWidth = 2, className, style }) {
  const Cmp = MAP[name] || Package;
  return <Cmp size={size} strokeWidth={strokeWidth} className={className} style={style} />;
}
