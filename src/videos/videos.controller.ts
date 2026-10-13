import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { VideosService } from './videos.service';
import { CreateVideoDto, UpdateVideoDto, CreateCategoryDto } from './dto';
import { AuthGuard } from '../auth/auth.guard';
import { AdminGuard } from '../auth/admin.guard';

@Controller()
export class VideosController {
  constructor(private videos: VideosService) {}

  // ---- 前台公開端點 ----
  @Get('categories')
  listCategories() {
    return this.videos.listCategories();
  }

  @Get('videos')
  listVideos(@Query('category_id') categoryId?: string) {
    return this.videos.listVideos(categoryId);
  }

  @Get('videos/:id')
  getVideo(@Param('id') id: string) {
    return this.videos.getVideo(id);
  }

  // ---- 後台管理端點：需登入且角色為 admin ----
  @UseGuards(AuthGuard, AdminGuard)
  @Post('admin/videos')
  createVideo(@Body() dto: CreateVideoDto) {
    return this.videos.createVideo(dto);
  }

  @UseGuards(AuthGuard, AdminGuard)
  @Get('admin/videos/:id/upload-url')
  getUploadUrl(@Param('id') id: string, @Query('filename') filename: string) {
    return this.videos.getUploadUrl(id, filename);
  }

  @UseGuards(AuthGuard, AdminGuard)
  @Post('admin/videos/:id/start-transcode')
  startTranscode(@Param('id') id: string) {
    return this.videos.startTranscode(id);
  }

  @UseGuards(AuthGuard, AdminGuard)
  @Patch('admin/videos/:id')
  updateVideo(@Param('id') id: string, @Body() dto: UpdateVideoDto) {
    return this.videos.updateVideo(id, dto);
  }

  @UseGuards(AuthGuard, AdminGuard)
  @Delete('admin/videos/:id')
  deleteVideo(@Param('id') id: string) {
    return this.videos.deleteVideo(id);
  }

  @UseGuards(AuthGuard, AdminGuard)
  @Post('admin/categories')
  createCategory(@Body() dto: CreateCategoryDto) {
    return this.videos.createCategory(dto);
  }

  @UseGuards(AuthGuard, AdminGuard)
  @Delete('admin/categories/:id')
  deleteCategory(@Param('id') id: string) {
    return this.videos.deleteCategory(id);
  }
}
