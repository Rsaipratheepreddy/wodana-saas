import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query, Res, StreamableFile, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import { RequestActor } from "../auth/actor";
import { CurrentActor } from "../auth/current-actor.decorator";
import { ArchiveBriefEntryDto, BulkBriefEntriesDto, SaveBriefDto, SaveBriefEntryDto, SaveRoomDto } from "./brief.dto";
import { BRIEF_MAX_BYTES, BriefService } from "./brief.service";
import { AddDesignVersionDto, DesignActivityDto, SaveDesignDto, SaveDesignFolderDto, UploadDesignFilesDto, CreateDesignThreadDto, ReplyDesignThreadDto, ResolveDesignThreadDto } from "./design.dto";
import { DesignService } from "./design.service";

import {ItemSpecificationService} from "./item-specification.service";
import {SaveItemSpecificationDto} from "./item-specification.dto";
import { PreProjectDefinitionService } from "./pre-project-definition.service";
import { PublishDefinitionBaselineDto, RecordDefinitionDecisionDto } from "./pre-project-definition.dto";

@Controller('workspaces/:workspaceId/pre-projects/:caseId')
export class CaseContentController {
 constructor(private readonly brief:BriefService,private readonly designs:DesignService,private readonly specifications:ItemSpecificationService,private readonly definitions:PreProjectDefinitionService){}
 @Get('definition-baselines') definitionBaselines(@CurrentActor() a:RequestActor,@Param('workspaceId',ParseUUIDPipe) w:string,@Param('caseId',ParseUUIDPipe) c:string) {return this.definitions.get(a,w,c);}
 @Post('definition-baselines') publishDefinition(@CurrentActor() a:RequestActor,@Param('workspaceId',ParseUUIDPipe) w:string,@Param('caseId',ParseUUIDPipe) c:string,@Body() b:PublishDefinitionBaselineDto) {return this.definitions.publish(a,w,c,b);}
 @Post('definition-baselines/:baselineId/decisions') definitionDecision(@CurrentActor() a:RequestActor,@Param('workspaceId',ParseUUIDPipe) w:string,@Param('caseId',ParseUUIDPipe) c:string,@Param('baselineId',ParseUUIDPipe) id:string,@Body() b:RecordDefinitionDecisionDto) {return this.definitions.recordDecision(a,w,c,id,b);}
 @Get('specifications/:id') specificationsHistory(@CurrentActor() a:RequestActor,@Param('workspaceId',ParseUUIDPipe) w:string,@Param('caseId',ParseUUIDPipe) c:string,@Param('id',ParseUUIDPipe) id:string) {return this.specifications.history(a,w,c,id);}
 @Put('specifications/:id') specification(@CurrentActor() a:RequestActor,@Param('workspaceId',ParseUUIDPipe) w:string,@Param('caseId',ParseUUIDPipe) c:string,@Param('id',ParseUUIDPipe) id:string,@Body() b:SaveItemSpecificationDto) {return this.specifications.save(a,w,c,id,b);}
 @Get('brief') get(@CurrentActor() a:RequestActor,@Param('workspaceId',ParseUUIDPipe) w:string,@Param('caseId',ParseUUIDPipe) c:string) {return this.brief.get(a,w,c);}
 @Put('brief') save(@CurrentActor() a:RequestActor,@Param('workspaceId',ParseUUIDPipe) w:string,@Param('caseId',ParseUUIDPipe) c:string,@Body() b:SaveBriefDto) {return this.brief.saveBrief(a,w,c,b);}
 @Put('rooms') room(@CurrentActor() a:RequestActor,@Param('workspaceId',ParseUUIDPipe) w:string,@Param('caseId',ParseUUIDPipe) c:string,@Body() b:SaveRoomDto) {return this.brief.saveRoom(a,w,c,b);}
 @Put('entries') entry(@CurrentActor() a:RequestActor,@Param('workspaceId',ParseUUIDPipe) w:string,@Param('caseId',ParseUUIDPipe) c:string,@Body() b:SaveBriefEntryDto) {return this.brief.saveEntry(a,w,c,b);}
 @Post('entries/bulk') bulk(@CurrentActor() a:RequestActor,@Param('workspaceId',ParseUUIDPipe) w:string,@Param('caseId',ParseUUIDPipe) c:string,@Body() b:BulkBriefEntriesDto) {return this.brief.bulkEntries(a,w,c,b.entries);}
 @Patch('entries/:id') archive(@CurrentActor() a:RequestActor,@Param('workspaceId',ParseUUIDPipe) w:string,@Param('caseId',ParseUUIDPipe) c:string,@Param('id',ParseUUIDPipe) id:string,@Body() b:ArchiveBriefEntryDto) {return this.brief.archiveEntry(a,w,c,id,b);}
 @Get('catalog-options') catalog(@CurrentActor() a:RequestActor,@Param('workspaceId',ParseUUIDPipe) w:string,@Param('caseId',ParseUUIDPipe) c:string,@Query('kind') kind='work',@Query('search') search='',@Query('relation') relation='',@Query('relatedId') relatedId='') {return this.brief.catalogOptions(a,w,c,kind,search,relation,relatedId);}
 @Post('assets/:id') @UseInterceptors(FileInterceptor('file',{limits:{fileSize:BRIEF_MAX_BYTES,files:1,fields:0}}))
 upload(@CurrentActor() a:RequestActor,@Param('workspaceId',ParseUUIDPipe) w:string,@Param('caseId',ParseUUIDPipe) c:string,@Param('id',ParseUUIDPipe) id:string,@UploadedFile() file:{buffer:Buffer;originalname:string;mimetype:string;size:number}) {return this.brief.upload(a,w,c,id,file);}
 @Get('assets/:id') async asset(@CurrentActor() a:RequestActor,@Param('workspaceId',ParseUUIDPipe) w:string,@Param('caseId',ParseUUIDPipe) c:string,@Param('id',ParseUUIDPipe) id:string,@Query('preview') preview:string,@Query('view') view:string,@Res({passthrough:true}) response:Response) {
  const file=await this.brief.asset(a,w,c,id,preview==='1');
  response.setHeader('Cache-Control','private, no-store');
  response.setHeader('X-Content-Type-Options','nosniff');
  response.setHeader('Content-Security-Policy',"sandbox; default-src 'none'");
  return new StreamableFile(file.body,{type:file.contentType,disposition:`${file.preview||(view==='1'&&file.contentType==='application/pdf')?'inline':'attachment'}; filename*=UTF-8''${encodeURIComponent(file.name)}`});
 }
 @Put('design-folders') folder(@CurrentActor() a:RequestActor,@Param('workspaceId',ParseUUIDPipe) w:string,@Param('caseId',ParseUUIDPipe) c:string,@Body() b:SaveDesignFolderDto) {return this.designs.saveFolder(a,w,c,b);}
 @Post('designs/upload') uploadDesigns(@CurrentActor() a:RequestActor,@Param('workspaceId',ParseUUIDPipe) w:string,@Param('caseId',ParseUUIDPipe) c:string,@Body() b:UploadDesignFilesDto) {return this.designs.uploadFiles(a,w,c,b);}
 @Post('designs/:id/threads') thread(@CurrentActor() a:RequestActor,@Param('workspaceId',ParseUUIDPipe) w:string,@Param('caseId',ParseUUIDPipe) c:string,@Param('id',ParseUUIDPipe) id:string,@Body() b:CreateDesignThreadDto){return this.designs.createThread(a,w,c,id,b);}
 @Post('designs/:id/threads/:threadId/replies') reply(@CurrentActor() a:RequestActor,@Param('workspaceId',ParseUUIDPipe) w:string,@Param('caseId',ParseUUIDPipe) c:string,@Param('id',ParseUUIDPipe) id:string,@Param('threadId',ParseUUIDPipe) threadId:string,@Body() b:ReplyDesignThreadDto){return this.designs.replyThread(a,w,c,id,threadId,b);}
 @Post('designs/:id/threads/:threadId/status') threadStatus(@CurrentActor() a:RequestActor,@Param('workspaceId',ParseUUIDPipe) w:string,@Param('caseId',ParseUUIDPipe) c:string,@Param('id',ParseUUIDPipe) id:string,@Param('threadId',ParseUUIDPipe) threadId:string,@Body() b:ResolveDesignThreadDto){return this.designs.resolveThread(a,w,c,id,threadId,b);}
 @Get('designs') list(@CurrentActor() a:RequestActor,@Param('workspaceId',ParseUUIDPipe) w:string,@Param('caseId',ParseUUIDPipe) c:string) {return this.designs.list(a,w,c);}
 @Put('designs') design(@CurrentActor() a:RequestActor,@Param('workspaceId',ParseUUIDPipe) w:string,@Param('caseId',ParseUUIDPipe) c:string,@Body() b:SaveDesignDto) {return this.designs.save(a,w,c,b);}
 @Post('designs/:id/versions') version(@CurrentActor() a:RequestActor,@Param('workspaceId',ParseUUIDPipe) w:string,@Param('caseId',ParseUUIDPipe) c:string,@Param('id',ParseUUIDPipe) id:string,@Body() b:AddDesignVersionDto) {return this.designs.addVersion(a,w,c,id,b);}
 @Post('designs/:id/activity') activity(@CurrentActor() a:RequestActor,@Param('workspaceId',ParseUUIDPipe) w:string,@Param('caseId',ParseUUIDPipe) c:string,@Param('id',ParseUUIDPipe) id:string,@Body() b:DesignActivityDto) {return this.designs.activity(a,w,c,id,b);}
}
