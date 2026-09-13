import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { CurrentActor } from '../auth/current-actor.decorator';
import { RequestActor } from '../auth/actor';
import { ReviewSiteMeasurementDto, SaveSiteMeasurementDto, SaveSiteObservationDto, SaveSiteVisitDto } from './site.dto';
import { SiteService } from './site.service';

@Controller('workspaces/:workspaceId/pre-projects/:caseId/site')
export class SiteController {
 constructor(private readonly site:SiteService){}
 @Get() list(@CurrentActor() a:RequestActor,@Param('workspaceId',ParseUUIDPipe) w:string,@Param('caseId',ParseUUIDPipe) c:string){return this.site.list(a,w,c);}
 @Put('visits') visit(@CurrentActor() a:RequestActor,@Param('workspaceId',ParseUUIDPipe) w:string,@Param('caseId',ParseUUIDPipe) c:string,@Body() b:SaveSiteVisitDto){return this.site.saveVisit(a,w,c,b);}
 @Put('observations') observation(@CurrentActor() a:RequestActor,@Param('workspaceId',ParseUUIDPipe) w:string,@Param('caseId',ParseUUIDPipe) c:string,@Body() b:SaveSiteObservationDto){return this.site.saveObservation(a,w,c,b);}
 @Put('measurements') measurement(@CurrentActor() a:RequestActor,@Param('workspaceId',ParseUUIDPipe) w:string,@Param('caseId',ParseUUIDPipe) c:string,@Body() b:SaveSiteMeasurementDto){return this.site.saveMeasurement(a,w,c,b);}
 @Get(':id/history') history(@CurrentActor() a:RequestActor,@Param('workspaceId',ParseUUIDPipe) w:string,@Param('caseId',ParseUUIDPipe) c:string,@Param('id',ParseUUIDPipe) id:string){return this.site.history(a,w,c,id);}
 @Post(':id/review') review(@CurrentActor() a:RequestActor,@Param('workspaceId',ParseUUIDPipe) w:string,@Param('caseId',ParseUUIDPipe) c:string,@Param('id',ParseUUIDPipe) id:string,@Body() b:ReviewSiteMeasurementDto){return this.site.review(a,w,c,id,b);}
}
